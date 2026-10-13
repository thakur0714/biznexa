import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  adminPaymentDetailSchema,
  adminPaymentListQuerySchema,
  adminPaymentListResponseSchema,
  type AdminPaymentListQuery,
} from '@biznexa/types';
import { AdminPaymentsService } from './admin-payments.service';
import { PERMS, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../common/openapi';

@ApiTags('admin · payments')
@ApiBearerAuth()
@RequirePermissions(PERMS.PAYMENTS_VIEW)
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly payments: AdminPaymentsService) {}

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
}
