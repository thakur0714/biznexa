import { BadRequestException, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  adminPaymentDetailSchema,
  adminPaymentListQuerySchema,
  adminPaymentListResponseSchema,
  idempotencyKeySchema,
  refundCreateInput,
  refundSchema,
  type AdminPaymentListQuery,
  type RefundCreateInput,
} from '@biznexa/types';
import { AdminPaymentsService } from './admin-payments.service';
import { RefundsService } from './refunds.service';
import { AuthUser, CurrentUser, PERMS, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';

/** The `Idempotency-Key` header, or 400 with what is wrong with it. */
function idempotencyKey(value: string | undefined): string {
  const r = idempotencyKeySchema.safeParse(value);
  if (!r.success) throw new BadRequestException(r.error.issues[0].message);
  return r.data;
}

@ApiTags('admin · payments')
@ApiBearerAuth()
@RequirePermissions(PERMS.PAYMENTS_VIEW)
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(
    private readonly payments: AdminPaymentsService,
    private readonly refunds: RefundsService,
  ) {}

  @ApiZodResponse('AdminPaymentList', adminPaymentListResponseSchema)
  @Get()
  list(@ZodQuery(adminPaymentListQuerySchema) q: AdminPaymentListQuery) {
    return this.payments.list(q);
  }

  @Get('export')
  async exportCsv(@ZodQuery(adminPaymentListQuerySchema) q: AdminPaymentListQuery, @Res() res: Response) {
    const csv = await this.payments.exportCsv(q);
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payments-${dateStr}.csv"`);
    res.status(200).send(csv);
  }

  @ApiZodResponse('AdminPaymentDetail', adminPaymentDetailSchema)
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.payments.get(id);
  }

  /**
   * Full or partial refund (M4.13). Only a SUCCESS or PARTIALLY_REFUNDED payment, up to what is left to
   * refund. Answers with the refund INITIATED; the gateway's webhook makes it PROCESSED or FAILED.
   */
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Unique per refund attempt; a retry with the same key returns the first refund' })
  @ApiZodResponse('Refund', refundSchema, 201)
  @ApiResponse({ status: 400, description: 'Bad amount or reason, more than is left to refund, or no Idempotency-Key' })
  @ApiResponse({ status: 409, description: 'The payment cannot be refunded now (not paid, refund in progress), or the key was used for a different refund' })
  @ApiResponse({ status: 502, description: 'The gateway refused the refund; it is recorded FAILED and the payment is unchanged' })
  @RequirePermissions(PERMS.PAYMENTS_VIEW, PERMS.PAYMENTS_REFUND)
  @HttpCode(201)
  @Post(':id/refunds')
  refund(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(refundCreateInput) body: RefundCreateInput,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.refunds.create(id, body, idempotencyKey(key), user.id);
  }
}
