import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { applyCouponInput, orderSummarySchema, type ApplyCouponInput } from '@biznexa/types';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { OrderSummaryService } from './order-summary.service';

const uuid = new ParseUUIDPipe();
const NotFound = () => ApiResponse({ status: 404, description: 'No such application among yours (another customer’s application looks the same)' });
const Gone = () => ApiResponse({ status: 409, description: 'A package on the order is no longer offered, or (coupon changes) payment has started' });

/**
 * The order summary step of the signed-in customer's own application (M3.13). Totals are always computed
 * here from the package prices, coupon and place of supply; requests carry no amounts.
 */
@ApiTags('applications')
@ApiBearerAuth()
@Controller('applications/:id')
export class OrderSummaryController {
  constructor(private readonly orders: OrderSummaryService) {}

  /** Fee, discount, GST (CGST + SGST or IGST by place of supply), government fee and total, recomputed now. A coupon that no longer applies is removed (`couponNotice`). */
  @ApiZodResponse('OrderSummary', orderSummarySchema)
  @NotFound()
  @Gone()
  @Get('summary')
  summary(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.orders.summary(u.id, id);
  }

  /** Apply (or replace) the coupon; returns the recomputed summary. Only `code` is accepted. */
  @ApiZodResponse('OrderSummary', orderSummarySchema)
  @ApiResponse({ status: 400, description: 'The coupon does not apply (`errors[].field` is `code`, with the reason), or the body has fields other than `code`' })
  @NotFound()
  @Gone()
  @Put('coupon')
  @HttpCode(200)
  applyCoupon(@Param('id', uuid) id: string, @ZodBody(applyCouponInput) body: ApplyCouponInput, @CurrentUser() u: AuthUser) {
    return this.orders.applyCoupon(u.id, id, body.code);
  }

  /** Remove the coupon; returns the recomputed summary. */
  @ApiZodResponse('OrderSummary', orderSummarySchema)
  @NotFound()
  @Gone()
  @Delete('coupon')
  removeCoupon(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.orders.removeCoupon(u.id, id);
  }
}
