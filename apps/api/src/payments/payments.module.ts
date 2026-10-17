import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { env } from '../config/env';
import { AdminPaymentsController } from './admin-payments.controller';
import { AdminPaymentsService } from './admin-payments.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { CustomerPaymentsService } from './customer-payments.service';
import { MockPaymentGateway } from './mock-payment-gateway';
import { PaymentGateway } from './payment-gateway';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';
import { PaymentsController } from './payments.controller';
import { RazorpayGateway } from './razorpay-gateway';
import { RefundsService } from './refunds.service';

function paymentGateway(): PaymentGateway {
  const e = env();
  return e.PAYMENT_GATEWAY === 'razorpay'
    ? new RazorpayGateway({ keyId: e.RAZORPAY_KEY_ID, keySecret: e.RAZORPAY_KEY_SECRET, webhookSecret: e.RAZORPAY_WEBHOOK_SECRET })
    : new MockPaymentGateway();
}

/** Online payments behind the `PaymentGateway` interface (D42). Start payment, webhooks (M3.16/M3.17) and refunds (M4.13) live here. */
@Module({
  imports: [ApplicationsModule],
  controllers: [PaymentsController, CheckoutController, PaymentWebhookController, AdminPaymentsController],
  providers: [{ provide: PaymentGateway, useFactory: paymentGateway }, CheckoutService, PaymentWebhookService, AdminPaymentsService, CustomerPaymentsService, RefundsService],
  exports: [PaymentGateway, RefundsService],
})
export class PaymentsModule {}

