import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  paymentCallbackInput,
  paymentCheckoutSchema,
  paymentStatusSchema,
  startPaymentInput,
  type PaymentCallbackInput,
  type StartPaymentInput,
} from '@biznexa/types';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { CheckoutService } from './checkout.service';

/** Paying for the signed-in customer's own application (M3.16, M3.18). The amount is always the server's order total. */
@ApiTags('applications')
@ApiBearerAuth()
@Controller('applications/:id/payment')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /**
   * "Pay": creates the payment and the gateway order for the amount computed now — the order total, the
   * advance (`plan: ADVANCE`, when the packages allow part payment) or, after an advance, the balance — and
   * moves the order and application to PAYMENT_PENDING. Calling again for the same amount returns the same payment.
   */
  @ApiZodResponse('PaymentCheckout', paymentCheckoutSchema)
  @ApiResponse({ status: 400, description: 'The body has a field other than `plan`, or the form answers are incomplete (`errors[].field` is a path inside `formData`)' })
  @ApiResponse({ status: 404, description: 'No such application among yours (another customer’s application looks the same)' })
  @ApiResponse({ status: 409, description: 'Already paid or cannot be paid online, the plan does not apply (no part payment for these packages; balance before an advance; full/advance after one), a package is no longer offered, the coupon stopped applying (check the new total), or nothing to pay' })
  @ApiResponse({ status: 502, description: 'The payment gateway refused the order; the payment stays open, try again' })
  @ApiResponse({ status: 503, description: 'The payment gateway could not be reached; the payment stays open, try again' })
  @Post()
  @HttpCode(200)
  start(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(startPaymentInput) body: StartPaymentInput, @CurrentUser() u: AuthUser) {
    return this.checkout.start(u.id, id, body?.plan);
  }

  /** The payment page (M3.18) polls this: `outcome` turns `PAID` only once the gateway's signed webhook has paid the order. */
  @ApiZodResponse('PaymentStatus', paymentStatusSchema)
  @ApiResponse({ status: 404, description: 'No such application among yours (another customer’s application looks the same)' })
  @Get()
  status(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() u: AuthUser) {
    return this.checkout.status(u.id, id);
  }

  /**
   * Checkout's success callback: with a valid signature the payment shows as "confirming" (PENDING). It never
   * marks the payment or order paid — only the webhook does — so it is safe to skip (browser closed).
   */
  @ApiZodResponse('PaymentStatus', paymentStatusSchema)
  @ApiResponse({ status: 400, description: 'Bad body, or the signature or ids don’t match a payment of this application' })
  @ApiResponse({ status: 404, description: 'No such application among yours (another customer’s application looks the same)' })
  @Post('callback')
  @HttpCode(200)
  callback(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(paymentCallbackInput) body: PaymentCallbackInput, @CurrentUser() u: AuthUser) {
    return this.checkout.callback(u.id, id, body);
  }
}
