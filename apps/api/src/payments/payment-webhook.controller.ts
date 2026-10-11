import { Controller, HttpCode, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/auth.decorators';
import { PaymentWebhookService } from './payment-webhook.service';

/**
 * The payment gateway's webhook (M3.17). Public: the signature over the raw body is the authentication.
 * Not rate limited, so a burst of gateway retries is never refused. Configure in the Razorpay dashboard as
 * `https://<api>/api/payments/webhook` with the `payment.captured` and `payment.failed` events.
 */
@ApiTags('payments')
@SkipThrottle()
@Controller('payments/webhook')
export class PaymentWebhookController {
  constructor(private readonly webhooks: PaymentWebhookService) {}

  /** Called by the payment gateway only. Answers 200 to every correctly signed event, including ones it ignores. */
  @ApiHeader({ name: 'X-Razorpay-Signature', required: true, description: 'Hex HMAC-SHA256 of the raw body with the webhook secret' })
  @ApiHeader({ name: 'X-Razorpay-Event-Id', required: false, description: 'Repeated on redelivery; an event is applied once' })
  @ApiResponse({ status: 200, description: 'Received (applied, or already applied, or not an event we act on)' })
  @ApiResponse({ status: 400, description: 'Missing or wrong signature, or a body that cannot be read; nothing is stored' })
  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>) {
    await this.webhooks.handle(req.rawBody, req.headers);
    return { received: true };
  }
}
