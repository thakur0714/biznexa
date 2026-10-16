import { Controller, Get, Patch, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  adminCustomerDetailSchema,
  adminCustomerListQuerySchema,
  adminCustomerListResponseSchema,
  adminCustomerStatusInputSchema,
  adminCustomerRowSchema,
  type AdminCustomerListQuery,
  type AdminCustomerStatusInput,
} from '@biznexa/types';
import { AdminCustomersService } from './admin-customers.service';
import { AuthUser, CurrentUser, PERMS, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';

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

  @ApiZodResponse('AdminCustomerRow', adminCustomerRowSchema)
  @RequirePermissions(PERMS.CUSTOMERS_MANAGE)
  @Patch(':id/status')
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(adminCustomerStatusInputSchema) body: AdminCustomerStatusInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.customers.changeStatus(id, body, user.id);
  }
}
