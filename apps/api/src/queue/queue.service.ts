import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy, Optional } from '@nestjs/common';
import { Job, Queue, Worker, type JobsOptions, type Processor, type WorkerOptions } from 'bullmq';
import { env } from '../config/env';

/**
 * BullMQ on Redis (PROMPT §2): notifications, reminders, PDFs, webhooks.
 *
 *   const q = queues.queue<{ invoiceId: string }>('pdf');        // producer
 *   queues.process<{ invoiceId: string }>('pdf', async (job) => …); // consumer
 *
 * Jobs retry with exponential backoff. A job that fails its last attempt (or throws
 * bullmq's `UnrecoverableError`) is copied to the `dead-letter` queue for inspection and
 * can be sent back with `requeueDeadLetter()`. Handlers must be idempotent: a job can run
 * more than once (retries, a worker crash mid-job).
 */
export const DEAD_LETTER_QUEUE = 'dead-letter';

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 }, // 5 s, 10 s, 20 s, 40 s
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/** Override REDIS_URL / QUEUE_PREFIX (tests). */
export const QUEUE_OPTIONS = Symbol('QUEUE_OPTIONS');
export interface QueueOptions {
  redisUrl?: string;
  prefix?: string;
}

export interface DeadLetter {
  queue: string;
  jobId: string | undefined;
  name: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  stacktrace: string[];
  failedAt: string;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger('Queue');
  private readonly connection: { url: string; maxRetriesPerRequest: null };
  private readonly prefix: string;
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];

  constructor(@Optional() @Inject(QUEUE_OPTIONS) options: QueueOptions = {}) {
    this.connection = { url: options.redisUrl ?? env().REDIS_URL, maxRetriesPerRequest: null };
    this.prefix = options.prefix ?? env().QUEUE_PREFIX;
  }

  /** Get (or create) a queue. `defaults` override DEFAULT_JOB_OPTIONS for every job added to it. */
  queue<T = unknown>(name: string, defaults: JobsOptions = {}): Queue<T> {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, prefix: this.prefix, defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, ...defaults } });
      // Without a listener bullmq prints every reconnect error with a full stack.
      q.on('error', (err) => this.logger.error(`${name} queue: ${err.message}`));
      this.queues.set(name, q);
    }
    return q as Queue<T>;
  }

  /** Start a worker for a queue. Final failures go to the dead-letter queue. */
  process<T = unknown, R = unknown>(name: string, handler: Processor<T, R>, opts: Partial<WorkerOptions> = {}): Worker<T, R> {
    const worker = new Worker<T, R>(name, handler, { concurrency: 5, ...opts, connection: this.connection, prefix: this.prefix });
    worker.on('failed', (job, err) => {
      if (!job) return;
      // finishedOn is only set when the job will not be retried again.
      if (!job.finishedOn) {
        this.logger.warn(`${name}#${job.id} attempt ${job.attemptsMade} failed: ${err.message}`);
        return;
      }
      this.deadLetter(name, job, err).catch((e) => this.logger.error(`Could not dead-letter ${name}#${job.id}: ${e}`));
    });
    worker.on('error', (err) => this.logger.error(`${name} worker error: ${err.message}`));
    this.workers.push(worker);
    return worker;
  }

  private async deadLetter(queue: string, job: Job, err: Error) {
    const entry: DeadLetter = {
      queue,
      jobId: job.id,
      name: job.name,
      data: job.data,
      failedReason: err.message,
      attemptsMade: job.attemptsMade,
      stacktrace: job.stacktrace ?? [],
      failedAt: new Date(job.finishedOn!).toISOString(),
    };
    // Kept until someone handles it; deterministic id so a duplicate event cannot add it twice.
    await this.queue<DeadLetter>(DEAD_LETTER_QUEUE).add(`${queue}:${job.name}`, entry, {
      jobId: `${queue}-${job.id}`,
      removeOnComplete: false,
      removeOnFail: false,
    });
    this.logger.error(`${queue}#${job.id} failed after ${job.attemptsMade} attempt(s), moved to ${DEAD_LETTER_QUEUE}: ${err.message}`);
  }

  /** Dead letters waiting for attention, newest first. */
  async deadLetters(start = 0, end = 49): Promise<(DeadLetter & { id: string })[]> {
    const jobs = await this.queue<DeadLetter>(DEAD_LETTER_QUEUE).getJobs(['waiting', 'delayed', 'prioritized'], start, end, false);
    return jobs.map((j) => ({ ...j.data, id: j.id! }));
  }

  /** Put a dead letter back on its original queue as a fresh job (full attempts) and remove it from the dead-letter queue. */
  async requeueDeadLetter(id: string) {
    const dlq = this.queue<DeadLetter>(DEAD_LETTER_QUEUE);
    const dead = await dlq.getJob(id);
    if (!dead) return null;
    const job = await this.queue(dead.data.queue).add(dead.data.name, dead.data.data);
    await dead.remove();
    this.logger.log(`Requeued dead letter ${id} as ${dead.data.queue}#${job.id}`);
    return job;
  }

  /**
   * Redis round trip for health checks. Times out instead of hanging: queue connections
   * wait forever for Redis to come back (maxRetriesPerRequest: null), which is right for jobs but not for /health.
   */
  async ping(timeoutMs = 2000): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)));
    const roundTrip = this.queue(DEAD_LETTER_QUEUE)
      .getJobCounts('waiting')
      .then(() => true)
      .catch(() => false);
    try {
      return await Promise.race([roundTrip, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy() {
    // Workers first so in-flight jobs finish (or are released) before the queues close.
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

@Global()
@Module({ providers: [QueueService], exports: [QueueService] })
export class QueueModule {}
