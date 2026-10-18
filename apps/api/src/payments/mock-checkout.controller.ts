import { ConflictException, Controller, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { mockPaymentResultSchema, type MockPaymentResult } from '@biznexa/types';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ApiZodResponse } from '../common/openapi';
import { PAYMENT_LIMIT } from '../common/rate-limits';
import { PrismaService } from '../prisma/prisma.service';
import { MockPaymentGateway } from './mock-payment-gateway';
import { PaymentGateway } from './payment-gateway';
import { PaymentWebhookService } from './payment-webhook.service';

/**
 * The mock gateway's "checkout window" (M8.8), so a payment can be completed in a browser in development:
 * the mock captures the payment and delivers its signed webhook through the real webhook code, then returns
 * what Razorpay Checkout's handler would get. 404 unless the mock gateway is in use (it is refused in production).
 */
@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments/mock')
export class MockCheckoutController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
    private readonly webhooks: PaymentWebhookService,
  ) {}

  @ApiZodResponse('MockPaymentResult', mockPaymentResultSchema)
  @ApiResponse({ status: 404, description: 'Not using the mock gateway, or no such open payment of yours' })
  @ApiResponse({ status: 409, description: 'The mock gateway no longer knows this order (the API restarted); start the payment again' })
  @Throttle(PAYMENT_LIMIT)
  @Post(':paymentId/pay')
  @HttpCode(200)
  async pay(@Param('paymentId', new ParseUUIDPipe()) paymentId: string, @CurrentUser() user: AuthUser): Promise<MockPaymentResult> {
    if (!(this.gateway instanceof MockPaymentGateway)) throw new NotFoundException();
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, gateway: 'MOCK', status: { in: ['CREATED', 'PENDING'] }, OR: [{ booking: { customerId: user.id } }, { order: { customerId: user.id } }] },
      select: { gatewayOrderId: true },
    });
    if (!payment?.gatewayOrderId) throw new NotFoundException('Payment not found');
    if (!this.gateway.orders.has(payment.gatewayOrderId)) throw new ConflictException('This test payment has expired. Start the payment again.');
    const result = this.gateway.pay(payment.gatewayOrderId);
    const hook = this.gateway.webhook('payment.captured', result.payment);
    await this.webhooks.handle(Buffer.from(hook.body), hook.headers);
    return { gatewayOrderId: result.orderId, gatewayPaymentId: result.paymentId, signature: result.signature };
  }
}
