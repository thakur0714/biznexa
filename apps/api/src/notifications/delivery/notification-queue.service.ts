import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { NotificationResult, SendNotificationInput } from '@biznexa/types';
import { Prisma, type NotificationDeliveryStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationDispatcherService, UnknownNotificationChannelError } from '../notification-dispatcher.service';
import { DELIVERY_ATTEMPTS, deliveryIdempotencyKey, isPermanentFailure, retryDelayMs, safeErrorText, BASE_RETRY_DELAY_MS } from './delivery-policy';
import { env } from '../../config/env';

export const NOTIFICATIONS_QUEUE = 'notifications';

/** Override retry timing (tests). */
export const NOTIFICATION_QUEUE_OPTIONS = Symbol('NOTIFICATION_QUEUE_OPTIONS');
export interface NotificationQueueOptions {
  retryBaseMs?: number;
  attempts?: number;
}

export interface EnqueueNotificationInput extends SendNotificationInput {
  /** The event occurrence (payment id, document id, reminder + offset…). Same event + source + user + channel = one delivery. */
  sourceKey: string;
  templateId?: string | null;
  /** Send later (booking reminders, M8.9). Past or missing = now. */
  sendAt?: Date | null;
}

interface NotificationJob {
  deliveryId: string;
}

/** What the job sends, kept on the delivery so a retry (also days later, by staff) sends the same message. */
interface DeliveryContent {
  title?: string;
  body: string;
  link?: string | null;
  payload?: Record<string, unknown> | null;
  /** Address given by the caller instead of the user record (an anonymised account, M5.12). Removed once the delivery is finished. */
  recipient?: SendNotificationInput['recipient'] | null;
}

const FINISHED = new Set<NotificationDeliveryStatus>(['SENT', 'DELIVERED', 'SKIPPED']);
/** A QUEUED delivery untouched this long has probably lost its job (Redis was down when it was queued). */
const STALE_QUEUED_MS = 15 * 60_000;

/** A caller-given address is kept only until the delivery is finished, then dropped from the log. */
function withoutRecipient(content: DeliveryContent): { content?: Prisma.InputJsonValue } {
  if (!content.recipient) return {};
  const { recipient: _recipient, ...rest } = content;
  return { content: rest as unknown as Prisma.InputJsonValue };
}

/**
 * Notification queue + delivery log (M6.3, D59). `enqueue` writes one `NotificationDelivery` row per
 * notification × channel (unique idempotency key, so a repeated event adds nothing) and queues a job whose
 * id is the row id. The worker sends through `NotificationDispatcherService` (preferences, channels) and
 * records the outcome; temporary failures retry with backoff (30 s … 1 h, 6 tries), permanent ones
 * (no address, provider refused) are FAILED at once. Provider callbacks later move SENT → DELIVERED / FAILED.
 */
@Injectable()
export class NotificationQueueService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger('NotificationQueue');
  private readonly retryBaseMs: number;
  private readonly attempts: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly dispatcher: NotificationDispatcherService,
    private readonly audit: AuditService,
    @Inject(NOTIFICATION_QUEUE_OPTIONS) options: NotificationQueueOptions,
  ) {
    this.retryBaseMs = options.retryBaseMs ?? BASE_RETRY_DELAY_MS;
    this.attempts = options.attempts ?? DELIVERY_ATTEMPTS;
  }

  private get queue() {
    // A type the built-in strategies don't know makes bullmq call the worker's backoffStrategy.
    return this.queues.queue<NotificationJob>(NOTIFICATIONS_QUEUE, { attempts: this.attempts, backoff: { type: 'notification' } });
  }

  onModuleInit() {
    this.queues.process<NotificationJob>(NOTIFICATIONS_QUEUE, (job: Job<NotificationJob>) => this.deliver(job), {
      concurrency: 5,
      settings: { backoffStrategy: (attemptsMade: number) => retryDelayMs(attemptsMade, this.retryBaseMs, Math.random()) }, // NOSONAR: retry jitter, not security
    });
  }

  /** Deliveries still QUEUED whose job was never added (Redis down) or lost are queued again on start. */
  async onApplicationBootstrap() {
    if (!env().QUEUE_BOOT_SWEEP) return;
    const stale = await this.prisma.notificationDelivery.findMany({
      where: { status: 'QUEUED', updatedAt: { lt: new Date(Date.now() - STALE_QUEUED_MS) }, createdAt: { gt: new Date(Date.now() - 7 * 24 * 3_600_000) } },
      select: { id: true, sendAt: true },
      take: 1000,
    });
    // Same job id as before: a job that is still waiting is not added twice.
    for (const d of stale) this.addJob(d.id, d.sendAt);
    if (stale.length) this.logger.log(`Queued ${stale.length} notification(s) still waiting to be sent`);
  }

  /**
   * Record and queue one notification. Returns the delivery and whether it is new; an existing key
   * (the event was handled before) queues nothing. Queuing itself doesn't wait for Redis.
   */
  async enqueue(input: EnqueueNotificationInput): Promise<{ id: string; created: boolean }> {
    const idempotencyKey = deliveryIdempotencyKey({ event: input.event, sourceKey: input.sourceKey, userId: input.userId, channel: input.channel });
    const content: DeliveryContent = {
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      payload: input.payload ?? null,
      ...(input.recipient ? { recipient: input.recipient } : {}),
    };
    const sendAt = input.sendAt && input.sendAt.getTime() > Date.now() ? input.sendAt : null;
    try {
      const row = await this.prisma.notificationDelivery.create({
        data: {
          idempotencyKey,
          userId: input.userId,
          event: input.event,
          sourceKey: input.sourceKey,
          channel: input.channel,
          category: input.category ?? 'TRANSACTIONAL',
          templateId: input.templateId ?? null,
          content: content as unknown as Prisma.InputJsonValue,
          sendAt,
        },
        select: { id: true },
      });
      this.addJob(row.id, sendAt);
      return { id: row.id, created: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey }, select: { id: true } });
        this.logger.log(`Skipped duplicate notification ${input.event} ${input.channel} for user=${input.userId} (delivery ${existing.id})`);
        return { id: existing.id, created: false };
      }
      throw err;
    }
  }

  private addJob(deliveryId: string, sendAt?: Date | null) {
    const delay = sendAt ? Math.max(0, sendAt.getTime() - Date.now()) : 0;
    this.queue
      .add('send', { deliveryId }, { jobId: deliveryId, delay })
      .catch((err) => this.logger.error(`Could not queue notification ${deliveryId}: ${err}`));
  }

  /**
   * The job. Idempotent: a delivery that was already sent (or skipped) is not sent again, and each try
   * is claimed first, so two jobs for one delivery cannot both send the same attempt.
   */
  /** One try through the dispatcher; a thrown error becomes a failed result. */
  private async send(row: { userId: string; channel: NotificationResult['channel']; event: string; category: string }, content: DeliveryContent): Promise<NotificationResult> {
    try {
      return await this.dispatcher.dispatch({
        userId: row.userId,
        channel: row.channel,
        event: row.event,
        category: row.category === 'MARKETING' ? 'MARKETING' : 'TRANSACTIONAL',
        title: content.title,
        body: content.body,
        link: content.link,
        payload: content.payload,
        ...(content.recipient ? { recipient: content.recipient } : {}),
      });
    } catch (err) {
      return {
        success: false,
        channel: row.channel,
        error: err instanceof Error ? err.message : String(err),
        permanent: err instanceof UnknownNotificationChannelError || isPermanentFailure(err),
      };
    }
  }

  private async recordSent(row: { id: string; channel: string }, content: DeliveryContent, result: NotificationResult, now: Date): Promise<NotificationDeliveryStatus> {
    // In-app has no provider: the row is in the inbox, so it is delivered. Other channels wait for a callback.
    let status: NotificationDeliveryStatus = row.channel === 'IN_APP' ? 'DELIVERED' : 'SENT';
    if (result.skipped) status = 'SKIPPED';
    await this.prisma.notificationDelivery.update({
      where: { id: row.id },
      data: {
        status,
        providerMessageId: result.notificationId ?? null,
        lastError: result.skipped ? safeErrorText(`Skipped: ${result.reason ?? 'nothing to send'}`) : null,
        sentAt: result.skipped ? null : now,
        deliveredAt: status === 'DELIVERED' ? now : null,
        failedAt: null,
        ...withoutRecipient(content),
      },
    });
    return status;
  }

  async deliver(job: Job<NotificationJob>): Promise<NotificationDeliveryStatus | 'missing' | 'busy'> {
    const { deliveryId } = job.data;
    const row = await this.prisma.notificationDelivery.findUnique({ where: { id: deliveryId } });
    if (!row) return 'missing';
    if (FINISHED.has(row.status)) return row.status;

    const claimed = await this.prisma.notificationDelivery.updateMany({
      where: { id: row.id, status: { in: ['QUEUED', 'FAILED'] }, attempts: row.attempts },
      data: { attempts: { increment: 1 }, status: 'QUEUED' },
    });
    if (!claimed.count) return 'busy';

    const content = row.content as unknown as DeliveryContent;
    const result = await this.send(row, content);

    const now = new Date();
    if (result.success) return this.recordSent(row, content, result, now);

    const error = safeErrorText(result.error ?? 'Unknown error');
    const final = result.permanent === true || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await this.prisma.notificationDelivery.update({
      where: { id: row.id },
      data: { lastError: error, ...(final ? { status: 'FAILED', failedAt: now, ...withoutRecipient(content) } : {}) },
    });
    this.logger.warn(`${row.channel} ${row.event} for user=${row.userId} failed (try ${row.attempts + 1}${result.permanent ? ', permanent' : ''}): ${error}`);
    // Permanent: done, nothing to retry. Otherwise throw so bullmq retries with backoff (dead-letter after the last try).
    if (result.permanent) return 'FAILED';
    throw new Error(error);
  }

  /** Staff retry of a FAILED delivery (full tries again). 404 unknown, 409 when it is not FAILED. */
  async retry(id: string, actorId: string): Promise<void> {
    const row = await this.prisma.notificationDelivery.findUnique({ where: { id }, select: { status: true, attempts: true, lastError: true } });
    if (!row) throw new NotFoundException('Delivery not found');
    if (row.status !== 'FAILED') throw new ConflictException(`Only a FAILED delivery can be retried (this one is ${row.status})`);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.notificationDelivery.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'QUEUED', failedAt: null, sendAt: null } });
      if (!count) throw new ConflictException('The delivery changed meanwhile; reload and try again');
      await this.audit.log(
        {
          actorId,
          action: 'notification.retry',
          entityType: 'NotificationDelivery',
          entityId: id,
          before: { status: 'FAILED', attempts: row.attempts, lastError: row.lastError },
          after: { status: 'QUEUED' },
        },
        tx,
      );
    });

    // The finished job still holds this id (completed or failed set); remove it so the new one is not ignored.
    void (async () => {
      const old = await this.queue.getJob(id);
      await old?.remove();
      await this.queue.add('send', { deliveryId: id }, { jobId: id });
    })().catch((err) => this.logger.error(`Could not queue retry of notification ${id}: ${err}`));
  }
}
