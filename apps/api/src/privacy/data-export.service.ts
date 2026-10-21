import { ConflictException, GoneException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Job } from 'bullmq';
import { Readable } from 'node:stream';
import { DATA_EXPORT_TTL_DAYS, type FileLinkResult } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { EventBus } from '../events/event-bus';
import { AuditService } from '../audit/audit.service';
import { newFileKey, StorageService } from '../files/storage.service';
import { checkSignedLink, contentDisposition, signedLink } from '../files/files.service';
import type { DataRequest } from '../generated/prisma/client';
import { collectExport } from './data-export.collector';
import { createZip } from './zip';

export const DATA_EXPORT_QUEUE = 'data-export';
const DAY = 86_400_000;

export type ExportResult = 'completed' | 'skipped';

/**
 * Data export job (M5.12): a new EXPORT request is queued at once (job id = request id). The worker claims it
 * (PENDING → PROCESSING), writes a ZIP of JSON files (`collectExport`) to private storage and completes it with
 * the key and `expiresAt` = now + 7 days, then the customer is notified. Downloads go through a 5-minute signed
 * link asked for by the owner (D50 pattern, scope `data-exports`). An hourly cleanup deletes expired files.
 */
@Injectable()
export class DataExportService implements OnApplicationBootstrap {
  private readonly log = new Logger('DataExport');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly storage: StorageService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap() {
    this.queues.process<{ requestId: string }>(DATA_EXPORT_QUEUE, (job: Job<{ requestId: string }>) => this.run(job.data.requestId), { concurrency: 1 });
    // Requests whose job was lost (Redis down when queued, a crash) are queued again.
    const open = await this.prisma.dataRequest
      .findMany({ where: { type: 'EXPORT', status: { in: ['PENDING', 'PROCESSING'] } }, select: { id: true } })
      .catch((e) => {
        this.log.error(`Could not list open exports: ${e}`);
        return [];
      });
    for (const r of open) this.enqueue(r.id);
    if (open.length) this.log.log(`Queued ${open.length} data export(s) still to prepare`);
  }

  /** Queue without waiting (adding blocks while Redis is down); the start-up sweep catches a lost one. */
  enqueue(requestId: string) {
    this.queues
      .queue(DATA_EXPORT_QUEUE)
      .add('export', { requestId }, { jobId: requestId, removeOnComplete: true })
      .catch((err) => this.log.error(`Could not queue data export ${requestId}: ${err}`));
  }

  /** The job. Idempotent: a finished, rejected or missing request is skipped; a file made by a lost race is removed. */
  async run(requestId: string, now = new Date()): Promise<ExportResult> {
    const claimed = await this.prisma.dataRequest.updateMany({
      where: { id: requestId, type: 'EXPORT', status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'PROCESSING' },
    });
    if (!claimed.count) return 'skipped';
    const { userId } = await this.prisma.dataRequest.findUniqueOrThrow({ where: { id: requestId }, select: { userId: true } });

    const zip = createZip(await collectExport(this.prisma, userId, now), now);
    const fileKey = newFileKey();
    await this.storage.write(fileKey, Readable.from(zip));
    const expiresAt = new Date(now.getTime() + DATA_EXPORT_TTL_DAYS * DAY);
    const done = await this.prisma.dataRequest
      .updateMany({ where: { id: requestId, status: 'PROCESSING', fileKey: null }, data: { status: 'COMPLETED', fileKey, completedAt: now, expiresAt } })
      .catch(async (e) => {
        await this.storage.remove(fileKey);
        throw e;
      });
    if (!done.count) {
      await this.storage.remove(fileKey);
      return 'skipped';
    }
    await this.audit.log({ action: 'privacy.export_complete', entityType: 'DataRequest', entityId: requestId, after: { sizeBytes: zip.length, expiresAt } });
    await this.events.emit('privacy.export_ready', { requestId, userId, expiresAt: expiresAt.toISOString() });
    return 'completed';
  }

  /** The owner's 5-minute link. Not theirs → 404; not ready → 409; expired → 410. */
  async createLink(userId: string, id: string, now = Date.now()): Promise<FileLinkResult> {
    const row = await this.prisma.dataRequest.findFirst({ where: { id, userId, type: 'EXPORT' } });
    if (!row) throw new NotFoundException('Export not found');
    assertDownloadable(row, now);
    return signedLink('data-exports', id, 'attachment', now);
  }

  /** Checks a signed link and opens the ZIP (expiry is checked again: a link made just before still fails after). */
  async openLinked(id: string, q: { e?: string; d?: string; s?: string }, now = Date.now()) {
    checkSignedLink('data-exports', id, q, now);
    const row = await this.prisma.dataRequest.findUnique({ where: { id } });
    if (row?.type !== 'EXPORT') throw new NotFoundException('Export not found');
    const fileKey = assertDownloadable(row, now);
    const { stream, size } = await this.storage.read(fileKey);
    const day = (row.completedAt ?? new Date(now)).toISOString().slice(0, 10);
    return { stream, size, disposition: contentDisposition('attachment', `biznexa-data-export-${day}.zip`) };
  }

  /** Deletes expired export files; the request row stays (COMPLETED, no file). */
  @Cron('17 * * * *')
  async cleanup(now = new Date()) {
    const expired = await this.prisma.dataRequest.findMany({
      where: { type: 'EXPORT', fileKey: { not: null }, expiresAt: { lte: now } },
      select: { id: true, fileKey: true },
      take: 500,
    });
    await Promise.all(expired.map((r) => this.removeFile(r.id, r.fileKey!)));
    if (expired.length) this.log.log(`Deleted ${expired.length} expired data export(s)`);
    return expired.length;
  }

  /** Storage first, then the key: a crash in between leaves a key whose file is gone, which downloads report as 404. */
  async removeFile(requestId: string, fileKey: string) {
    try {
      await this.storage.remove(fileKey);
      await this.prisma.dataRequest.updateMany({ where: { id: requestId, fileKey }, data: { fileKey: null } });
    } catch (e) {
      this.log.error(`Could not delete data export ${requestId}: ${e}`);
    }
  }
}

function assertDownloadable(row: DataRequest, now: number): string {
  if (row.status !== 'COMPLETED') throw new ConflictException('Your file is still being prepared. Please try again in a minute.');
  if (!row.fileKey || !row.expiresAt || row.expiresAt.getTime() <= now) {
    throw new GoneException('This download has expired. Please ask for a new copy of your data.');
  }
  return row.fileKey;
}
