import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  adminStaffActionResponseSchema, adminStaffListQuerySchema, adminStaffListResponseSchema, adminStaffRoleOptionsSchema, adminStaffTwoFactorResetResponseSchema,
  adminStaffStatusInputSchema, createAdminStaffInputSchema, updateAdminStaffRolesInputSchema,
  type AdminStaffListQuery, type AdminStaffStatusInput, type CreateAdminStaffInput, type UpdateAdminStaffRolesInput,
} from '@biznexa/types';
import { AuthUser, CurrentUser, PERMS, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';
import { StaffUsersService } from './staff-users.service';

@ApiTags('admin · staff users')
@ApiBearerAuth()
@RequirePermissions(PERMS.USERS_MANAGE)
@Controller('admin/staff-users')
export class StaffUsersController {
  constructor(private readonly staff: StaffUsersService) {}

  @Get('roles')
  @ApiZodResponse('AdminStaffRoleOptions', adminStaffRoleOptionsSchema)
  roles() { return this.staff.roleOptions(); }

  @Get()
  @ApiZodResponse('AdminStaffList', adminStaffListResponseSchema)
  list(@ZodQuery(adminStaffListQuerySchema) query: AdminStaffListQuery) { return this.staff.list(query); }

  @Post()
  @ApiZodResponse('AdminStaffActionResponse', adminStaffActionResponseSchema, 201)
  create(@ZodBody(createAdminStaffInputSchema) body: CreateAdminStaffInput, @CurrentUser() actor: AuthUser) { return this.staff.create(body, actor.id); }

  @Patch(':id/roles')
  @ApiZodResponse('AdminStaffActionResponse', adminStaffActionResponseSchema)
  updateRoles(@Param('id', ParseUUIDPipe) id: string, @ZodBody(updateAdminStaffRolesInputSchema) body: UpdateAdminStaffRolesInput, @CurrentUser() actor: AuthUser) {
    return this.staff.updateRoles(id, body, actor.id);
  }

  @Patch(':id/status')
  @ApiZodResponse('AdminStaffActionResponse', adminStaffActionResponseSchema)
  setActive(@Param('id', ParseUUIDPipe) id: string, @ZodBody(adminStaffStatusInputSchema) body: AdminStaffStatusInput, @CurrentUser() actor: AuthUser) {
    return this.staff.setActive(id, body, actor.id);
  }

  @Post(':id/reset-2fa')
  @ApiZodResponse('AdminStaff2FAReset', adminStaffTwoFactorResetResponseSchema)
  resetTwoFactor(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) { return this.staff.resetTwoFactor(id, actor.id); }
}
