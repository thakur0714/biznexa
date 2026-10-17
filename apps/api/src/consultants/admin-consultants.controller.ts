import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  adminConsultantActionResponseSchema,
  adminConsultantDetailSchema,
  adminConsultantListQuerySchema,
  adminConsultantListSchema,
  adminConsultantProfileInputSchema,
  consultantRejectInputSchema,
  PERMS,
  type AdminConsultantListQuery,
  type AdminConsultantProfileInput,
  type ConsultantRejectInput,
} from '@biznexa/types';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';
import { ConsultantsService } from './consultants.service';

@ApiTags('admin · consultants')
@ApiBearerAuth()
@RequirePermissions(PERMS.CONSULTANTS_MANAGE)
@Controller('admin/consultants')
export class AdminConsultantsController {
  constructor(private readonly consultants: ConsultantsService) {}

  @ApiZodResponse('AdminConsultantList', adminConsultantListSchema)
  @Get()
  list(@ZodQuery(adminConsultantListQuerySchema) query: AdminConsultantListQuery) {
    return this.consultants.listAdmin(query);
  }

  @ApiZodResponse('AdminConsultantDetail', adminConsultantDetailSchema)
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.consultants.getAdmin(id);
  }

  @ApiZodResponse('AdminConsultantDetail', adminConsultantDetailSchema)
  @Patch(':id/profile')
  updateProfile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(adminConsultantProfileInputSchema) body: AdminConsultantProfileInput,
    @CurrentUser() staff: AuthUser,
  ) {
    return this.consultants.updateAdminProfile(id, body, staff.id);
  }

  @ApiZodResponse('AdminConsultantActionResponse', adminConsultantActionResponseSchema)
  @Post(':id/approve')
  approve(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() staff: AuthUser) {
    return this.consultants.approve(id, staff.id);
  }

  @ApiZodResponse('AdminConsultantActionResponse', adminConsultantActionResponseSchema)
  @Post(':id/reject')
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(consultantRejectInputSchema) body: ConsultantRejectInput,
    @CurrentUser() staff: AuthUser,
  ) {
    return this.consultants.reject(id, body, staff.id);
  }

  @ApiZodResponse('AdminConsultantActionResponse', adminConsultantActionResponseSchema)
  @Post(':id/suspend')
  suspend(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() staff: AuthUser) {
    return this.consultants.suspend(id, staff.id);
  }
}
