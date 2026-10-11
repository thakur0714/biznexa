import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { env } from '../config/env';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { MockPaymentGateway } from './mock-payment-gateway';
import { PaymentGateway } from './payment-gateway';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';
import { RazorpayGateway } from './razorpay-gateway';

function paymentGateway(): PaymentGateway {
  const e = env();
  return e.PAYMENT_GATEWAY === 'razorpay'
    ? new RazorpayGateway({ keyId: e.RAZORPAY_KEY_ID, keySecret: e.RAZORPAY_KEY_SECRET, webhookSecret: e.RAZORPAY_WEBHOOK_SECRET })
    : new MockPaymentGateway();
}

/** Online payments behind the `PaymentGateway` interface (D42). Start payment and webhooks (M3.16/M3.17) live here. */
@Module({
  imports: [ApplicationsModule],
  controllers: [CheckoutController, PaymentWebhookController],
  providers: [{ provide: PaymentGateway, useFactory: paymentGateway }, CheckoutService, PaymentWebhookService],
  exports: [PaymentGateway],
})
export class PaymentsModule {}
