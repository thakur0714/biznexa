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

    const updates = msg91Reports(body).flatMap((r) => {
      const id = typeof r?.requestId === 'string' ? r.requestId : '';
      return (Array.isArray(r?.report) ? r.report : []).flatMap((line) => {
        const desc = scalarText(line?.desc);
        const outcome = msg91Outcome(scalarText(line?.status), desc);
        return outcome ? [{ id, outcome, desc }] : [];
      });
    });

    let updated = 0;
    // In report order, so a later status for the same message wins.
    for (const u of updates) updated += await this.apply('SMS', u.id, u.outcome, u.desc); // NOSONAR
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

    const updates = (events as { event?: unknown; sg_message_id?: unknown; reason?: unknown; type?: unknown }[]).flatMap((e): { id: string; outcome: Outcome; reason?: string }[] => {
      // sg_message_id = "<X-Message-Id from the send>.<filter suffix>"
      const id = typeof e?.sg_message_id === 'string' ? e.sg_message_id.split('.')[0] : '';
      if (e?.event === 'delivered') return [{ id, outcome: 'DELIVERED' }];
      if (e?.event !== 'bounce' && e?.event !== 'dropped') return [];
      const reason = typeof e.reason === 'string' ? `${e.event} (${e.reason})` : e.event;
      return [{ id, outcome: 'FAILED', reason }];
    });

    let updated = 0;
    // In event order, so a later status for the same message wins.
    for (const u of updates) updated += await this.apply('EMAIL', u.id, u.outcome, u.reason); // NOSONAR
    if (updated) this.logger.log(`SendGrid: ${updated} delivery report(s) applied`);
    return { updated };
  }
}

/** Text of a string/number field from a provider payload; anything else is ''. */
const scalarText = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

type Msg91Report = { requestId?: unknown; report?: { status?: unknown; desc?: unknown }[] };

/** MSG91 posts the list as JSON, or as a form whose `data` field holds the JSON. */
function msg91Reports(body: unknown): Msg91Report[] {
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
  return reports as Msg91Report[];
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
