import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { Readable } from 'node:stream';
import { EventBus } from '../events/event-bus';
import { QueueService } from '../queue/queue.service';
import { newFileKey, StorageService } from '../files/storage.service';
import { PdfRenderError, PdfRenderer, type PdfOptions } from './pdf-renderer';
import { env } from '../config/env';

export const PDF_QUEUE = 'pdf';

export interface PdfJob {
  kind: string;
  id: string;
}

/**
 * A kind of PDF (invoice, certificate…): where its HTML comes from and where its storage key is kept.
 * Registered once with `PdfService.register`, usually in the owning service's `onModuleInit`.
 */
export interface PdfDocument {
  /** The stored key when this record already has its PDF; the job then does nothing. */
  existing(id: string): Promise<string | null>;
  /** The page to print, or null when the record is gone (the job ends quietly). */
  source(id: string): Promise<{ html: string; options?: PdfOptions } | null>;
  /**
   * Saves the key on the record **only if it has none yet** (e.g. `updateMany … where pdfKey: null`) and
   * says whether it did. False means another run got there first: the new file is deleted.
   */
  attach(id: string, fileKey: string): Promise<boolean>;
  /** Records still without a PDF, queued again when the app starts (a lost job, Redis down when queued). */
  missing?(): Promise<string[]>;
}

export type PdfResult = 'generated' | 'exists' | 'missing';

/**
 * PDF generation (M3.22, D49) as a queue job: `enqueue(kind, id)` → the worker asks the registered
 * `PdfDocument` for the HTML, renders it (`PdfRenderer`), writes the bytes through `StorageService` under a
 * new random key and attaches the key to the record, then emits `pdf.generated`. Idempotent: one job per
 * record at a time (job id), a record that has its PDF is skipped, and a second file made by a race is
 * removed. Renderer and storage failures retry with backoff, then go to the dead-letter queue.
 */
@Injectable()
export class PdfService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Pdf');
  private readonly documents = new Map<string, PdfDocument>();

  constructor(
    private readonly renderer: PdfRenderer,
    private readonly storage: StorageService,
    private readonly queues: QueueService,
    private readonly events: EventBus,
  ) {}

  private get queue() {
    return this.queues.queue<PdfJob>(PDF_QUEUE);
  }

  register(kind: string, document: PdfDocument) {
    if (!/^[a-z][a-z0-9-]*$/.test(kind)) throw new Error(`PDF kind must be lower-case letters, digits and dashes: ${kind}`);
    if (this.documents.has(kind)) throw new Error(`PDF kind ${kind} is already registered`);
    this.documents.set(kind, document);
  }

  /**
   * The worker starts after every module's `onModuleInit`, so each kind is registered before a job runs;
   * then each kind's records still without a PDF are queued.
   */
  async onApplicationBootstrap() {
    this.queues.process<PdfJob>(PDF_QUEUE, (job: Job<PdfJob>) => this.generate(job.data.kind, job.data.id), { concurrency: 2 });
    if (env().QUEUE_BOOT_SWEEP) await this.queueMissing();
  }

  /** Queue every record of these kinds (default all) that still has no PDF. */
  async queueMissing(kinds: string[] = [...this.documents.keys()]) {
    for (const kind of kinds) {
      const doc = this.documents.get(kind);
      if (!doc) throw new Error(`Unknown PDF kind ${kind}`);
      const ids = (await doc.missing?.().catch((e) => (this.log.error(`Could not list ${kind} records without a PDF: ${e}`), []))) ?? [];
      for (const id of ids) this.enqueue(kind, id);
      if (ids.length) this.log.log(`Queued ${ids.length} ${kind} PDF(s) still to generate`);
    }
  }

  async onModuleDestroy() {
    await this.renderer.close();
  }

  /**
   * Queue a PDF without waiting (queuing blocks while Redis is down; the caller must not). One job per record
   * at a time. A finished job is removed at once (the job is idempotent), so the same record can be queued
   * again later — e.g. a download asking for a PDF whose key was cleared — instead of being ignored for a day.
   */
  enqueue(kind: string, id: string) {
    if (!this.documents.has(kind)) throw new Error(`Unknown PDF kind ${kind}`);
    this.queue.add(kind, { kind, id }, { jobId: `${kind}-${id}`, removeOnComplete: true }).catch((err) => this.log.error(`Could not queue the ${kind} PDF for ${id}: ${err}`));
  }

  /** The job; also callable directly (tests, an admin "regenerate" later). */
  async generate(kind: string, id: string): Promise<PdfResult> {
    const doc = this.documents.get(kind);
    if (!doc) throw new UnrecoverableError(`Unknown PDF kind ${kind}`);
    if (await doc.existing(id)) return 'exists';
    const source = await doc.source(id);
    if (!source) return 'missing';

    let pdf: Buffer;
    try {
      pdf = await this.renderer.render(source.html, source.options);
    } catch (err) {
      if (err instanceof PdfRenderError) throw new UnrecoverableError(`${kind} ${id}: ${err.message}`);
      throw err;
    }
    const fileKey = newFileKey();
    await this.storage.write(fileKey, Readable.from(pdf));
    let attached = false;
    try {
      attached = await doc.attach(id, fileKey);
    } finally {
      if (!attached) await this.storage.remove(fileKey);
    }
    if (!attached) return 'exists';
    await this.events.emit('pdf.generated', { kind, id, fileKey, sizeBytes: pdf.length });
    return 'generated';
  }
}
