import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  adminCustomerDetailSchema,
  adminCustomerListQuerySchema,
  adminCustomerListResponseSchema,
  type AdminCustomerListQuery,
} from '@biznexa/types';
import { AdminCustomersService } from './admin-customers.service';
import { PERMS, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../common/openapi';

@ApiTags('admin · customers')
@ApiBearerAuth()
@RequirePermissions(PERMS.CUSTOMERS_VIEW)
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly customers: AdminCustomersService) {}

  @ApiZodResponse('AdminCustomerList', adminCustomerListResponseSchema)
  @Get()
  list(@ZodQuery(adminCustomerListQuerySchema) q: AdminCustomerListQuery) {
    return this.customers.list(q);
  }

  @ApiZodResponse('AdminCustomerDetail', adminCustomerDetailSchema)
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.detail(id);
  }
}
