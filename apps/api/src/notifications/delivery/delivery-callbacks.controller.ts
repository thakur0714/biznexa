import { Body, Controller, Headers, HttpCode, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiHeader, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/auth.decorators';
import { DeliveryCallbacksService } from './delivery-callbacks.service';

/**
 * Delivery reports from notification providers (M6.3). Public: a token (MSG91) or signature (SendGrid)
 * is the authentication. Not rate limited, so a burst of reports is never refused. A provider whose
 * secret is not configured answers 404 — its deliveries simply stay SENT.
 */
@ApiTags('notifications')
@SkipThrottle()
@Controller('notifications/callbacks')
export class DeliveryCallbacksController {
  constructor(private readonly callbacks: DeliveryCallbacksService) {}

  /** MSG91 delivery report URL: `https://<api>/api/notifications/callbacks/msg91?token=<MSG91_WEBHOOK_TOKEN>`. */
  @ApiQuery({ name: 'token', required: true })
  @ApiResponse({ status: 200, description: 'Applied (unknown or non-final reports are ignored)' })
  @ApiResponse({ status: 401, description: 'Wrong token' })
  @Public()
  @Post('msg91')
  @HttpCode(200)
  msg91(@Query('token') token: string | undefined, @Body() body: unknown) {
    return this.callbacks.msg91(token, body);
  }

  /** SendGrid Event Webhook (signed): `https://<api>/api/notifications/callbacks/sendgrid`. */
  @ApiHeader({ name: 'X-Twilio-Email-Event-Webhook-Signature', required: true })
  @ApiHeader({ name: 'X-Twilio-Email-Event-Webhook-Timestamp', required: true })
  @ApiResponse({ status: 200, description: 'Applied (unknown or other events are ignored)' })
  @ApiResponse({ status: 401, description: 'Missing or wrong signature' })
  @Public()
  @Post('sendgrid')
  @HttpCode(200)
  sendgrid(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-twilio-email-event-webhook-signature') signature: string | undefined,
    @Headers('x-twilio-email-event-webhook-timestamp') timestamp: string | undefined,
  ) {
    return this.callbacks.sendgrid(req.rawBody, signature, timestamp);
  }
}
