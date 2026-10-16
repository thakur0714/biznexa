import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  customerPaymentListQuerySchema,
  customerPaymentListResponseSchema,
  type CustomerPaymentListQuery,
} from '@biznexa/types';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../common/openapi';
import { CustomerPaymentsService } from './customer-payments.service';

/** The signed-in customer's own payments; nobody else's are visible here (M5.10). */
@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: CustomerPaymentsService) {}

  @ApiZodResponse('CustomerPaymentList', customerPaymentListResponseSchema)
  @Get()
  list(@ZodQuery(customerPaymentListQuerySchema) q: CustomerPaymentListQuery, @CurrentUser() user: AuthUser) {
    return this.payments.list(user.id, q);
  }
}
