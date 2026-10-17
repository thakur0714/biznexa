import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import type { FileScanStatus } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { EventBus } from '../events/event-bus';
import { StorageService } from './storage.service';
import { VirusScanner } from './virus-scanner';
import { env } from '../config/env';

export const FILE_SCAN_QUEUE = 'file-scan';

/**
 * Virus scan after upload (M2.5.7, D23). `FilesService.record` queues one job per file
 * (job id = file id, so queuing twice is harmless); the worker scans the stored bytes and marks the
 * file CLEAN or INFECTED. Infected bytes are deleted; the row stays. Scanner outages are retried
 * (≈20 min) and then dead-lettered — the file stays PENDING and cannot be downloaded meanwhile.
 */
@Injectable()
export class FileScanService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger('FileScan');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly scanner: VirusScanner,
    private readonly queues: QueueService,
    private readonly events: EventBus,
  ) {}

  private get queue() {
    return this.queues.queue<{ fileId: string }>(FILE_SCAN_QUEUE, { attempts: 8, backoff: { type: 'exponential', delay: 10_000 } });
  }

  onModuleInit() {
    this.queues.process<{ fileId: string }>(FILE_SCAN_QUEUE, (job: Job<{ fileId: string }>) => this.scan(job.data.fileId), { concurrency: 2 });
  }

  /** Files left PENDING because queuing failed (Redis down) or the process stopped are queued again on start. */
  async onApplicationBootstrap() {
    if (!env().QUEUE_BOOT_SWEEP) return;
    const pending = await this.prisma.storedFile.findMany({ where: { scanStatus: 'PENDING', deletedAt: null }, select: { id: true } });
    for (const { id } of pending) this.enqueue(id);
    if (pending.length) this.logger.log(`Queued ${pending.length} file(s) still waiting for a virus scan`);
  }

  /** Queue a scan without waiting: queuing blocks while Redis is unreachable, and the upload must not. */
  enqueue(fileId: string) {
    this.queue.add('scan', { fileId }, { jobId: fileId }).catch((err) => this.logger.error(`Could not queue a scan of ${fileId}: ${err}`));
  }

  /** The job. Idempotent: a file that already has a result is not scanned again. */
  async scan(fileId: string): Promise<FileScanStatus | 'missing'> {
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt) return 'missing'; // deleted with its owner's account (M5.12): nothing to scan
    if (file.scanStatus === 'INFECTED') await this.storage.remove(file.fileKey); // an earlier attempt may have stopped before removing it
    if (file.scanStatus !== 'PENDING') return file.scanStatus;

    let stream;
    try {
      ({ stream } = await this.storage.read(file.fileKey));
    } catch (err) {
      if (err instanceof NotFoundException) throw new UnrecoverableError(`Stored bytes for file ${fileId} are missing`);
      throw err;
    }
    const verdict = await this.scanner.scan(stream);
    const status = verdict.infected ? 'INFECTED' : 'CLEAN';
    const signature = verdict.infected ? verdict.signature : null;

    const { count } = await this.prisma.storedFile.updateMany({
      where: { id: fileId, scanStatus: 'PENDING' },
      data: { scanStatus: status, scanSignature: signature, scannedAt: new Date() },
    });
    if (verdict.infected) {
      await this.storage.remove(file.fileKey);
      this.logger.warn(`File ${fileId} (owner ${file.ownerId}) is infected with ${signature}; stored bytes deleted`);
    }
    if (count) await this.events.emit('file.scanned', { fileId, ownerId: file.ownerId, status, signature });
    return status;
  }
}
