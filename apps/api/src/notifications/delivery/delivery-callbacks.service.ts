import { BadRequestException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import type { NotificationChannel } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { env } from '../../config/env';
import { safeErrorText } from './delivery-policy';

/** Webhook secrets; a provider whose secret is empty has its callback switched off (404). */
export const DELIVERY_CALLBACK_CONFIG = Symbol('DELIVERY_CALLBACK_CONFIG');
export interface DeliveryCallbackConfig {
  /** Shared token in the MSG91 delivery report URL (`?token=`); MSG91 does not sign its reports. */
  msg91Token: string;
  /** SendGrid Event Webhook verification key (base64 DER public key from the SendGrid settings page). */
  sendgridPublicKey: string;
}

export const deliveryCallbackConfigProvider = {
  provide: DELIVERY_CALLBACK_CONFIG,
  useFactory: (): DeliveryCallbackConfig => ({ msg91Token: env().MSG91_WEBHOOK_TOKEN, sendgridPublicKey: env().SENDGRID_WEBHOOK_PUBLIC_KEY }),
};

type Outcome = 'DELIVERED' | 'FAILED';

/**
 * Provider delivery reports (M6.3): a SENT delivery becomes DELIVERED or FAILED. Only SENT rows move,
 * so a late or repeated report never undoes a later state. Unknown message ids are ignored (200).
 */
@Injectable()
export class DeliveryCallbacksService {
  private readonly logger = new Logger('DeliveryCallbacks');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DELIVERY_CALLBACK_CONFIG) private readonly config: DeliveryCallbackConfig,
  ) {}

  /** Apply one report. Returns how many deliveries changed (0 or 1). */
  async apply(channel: NotificationChannel, providerMessageId: string, outcome: Outcome, reason?: string): Promise<number> {
    if (!providerMessageId) return 0;
    const now = new Date();
    const { count } = await this.prisma.notificationDelivery.updateMany({
      where: { channel, providerMessageId, status: 'SENT' },
      data:
        outcome === 'DELIVERED'
          ? { status: 'DELIVERED', deliveredAt: now }
          : { status: 'FAILED', failedAt: now, lastError: safeErrorText(`Provider reported: ${reason || 'not delivered'}`) },
    });
    return count;
  }

  /**
   * MSG91 delivery report: JSON (or form field `data` holding JSON) — a list of
   * `{ requestId, report: [{ status, desc }] }`. Status 1 = delivered, 2 / 9 / 16 / 17 / 25 / 26 = failed
   * (failed, NDNC, rejected, blocked…); anything else (submitted, pending) is not final and ignored.
   */
  async msg91(token: string | undefined, body: unknown): Promise<{ updated: number }> {
    if (!this.config.msg91Token) throw new NotFoundException();
    if (!token || !safeEqual(token, this.config.msg91Token)) throw new UnauthorizedException('Bad token');

    let reports: unknown = body;
    if (reports && typeof reports === 'object' && !Array.isArray(reports) && 'data' in reports) reports = (reports as { data: unknown }).data;
    if (typeof reports === 'string') {
      try {
        reports = JSON.parse(reports);
      } catch {
        throw new BadRequestException('Unreadable report');
      }
    }
    if (!Array.isArray(reports)) throw new BadRequestException('Unreadable report');

    let updated = 0;
    for (const r of reports as { requestId?: unknown; report?: { status?: unknown; desc?: unknown }[] }[]) {
      const id = typeof r?.requestId === 'string' ? r.requestId : '';
      for (const line of Array.isArray(r?.report) ? r.report : []) {
        const outcome = msg91Outcome(String(line?.status ?? ''), String(line?.desc ?? ''));
        if (outcome) updated += await this.apply('SMS', id, outcome, String(line?.desc ?? ''));
      }
    }
    return { updated };
  }

  /**
   * SendGrid Event Webhook, signed (ECDSA over timestamp + raw body). `delivered` → DELIVERED;
   * `bounce` / `dropped` (bad address, unsubscribed, spam report) → FAILED. Other events are ignored.
   */
  async sendgrid(rawBody: Buffer | undefined, signature: string | undefined, timestamp: string | undefined): Promise<{ updated: number }> {
    if (!this.config.sendgridPublicKey) throw new NotFoundException();
    if (!rawBody || !signature || !timestamp) throw new UnauthorizedException('Missing signature');
    if (!sendgridSignatureValid(this.config.sendgridPublicKey, rawBody, signature, timestamp)) throw new UnauthorizedException('Bad signature');

    let events: unknown;
    try {
      events = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Unreadable events');
    }
    if (!Array.isArray(events)) throw new BadRequestException('Unreadable events');

    let updated = 0;
    for (const e of events as { event?: unknown; sg_message_id?: unknown; reason?: unknown; type?: unknown }[]) {
      // sg_message_id = "<X-Message-Id from the send>.<filter suffix>"
      const id = typeof e?.sg_message_id === 'string' ? e.sg_message_id.split('.')[0] : '';
      if (e?.event === 'delivered') updated += await this.apply('EMAIL', id, 'DELIVERED');
      else if (e?.event === 'bounce' || e?.event === 'dropped') updated += await this.apply('EMAIL', id, 'FAILED', `${e.event}${typeof e.reason === 'string' ? ` (${e.reason})` : ''}`);
    }
    if (updated) this.logger.log(`SendGrid: ${updated} delivery report(s) applied`);
    return { updated };
  }
}

export function msg91Outcome(status: string, desc: string): Outcome | null {
  if (status === '1' || /^delivered$/i.test(desc.trim())) return 'DELIVERED';
  if (['2', '9', '16', '17', '25', '26'].includes(status) || /fail|reject|ndnc|block|invalid/i.test(desc)) return 'FAILED';
  return null;
}

export function sendgridSignatureValid(publicKeyBase64: string, rawBody: Buffer, signature: string, timestamp: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' });
    return verify('sha256', Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
