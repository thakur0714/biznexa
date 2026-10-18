import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  adminConsultantActionResponseSchema,
  adminConsultantDetailSchema,
  adminConsultantListQuerySchema,
  adminConsultantListSchema,
  adminConsultantProfileInputSchema,
  consultantRejectInputSchema,
  consultantFeeChangeActionResponseSchema,
  consultantFeeChangeDecisionSchema,
  adminConsultantFeaturedInputSchema,
  PERMS,
  type AdminConsultantListQuery,
  type AdminConsultantProfileInput,
  type ConsultantRejectInput,
  type ConsultantFeeChangeDecision,
  type AdminConsultantFeaturedInput,
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

  @Patch(':id/featured')
  setFeatured(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(adminConsultantFeaturedInputSchema) body: AdminConsultantFeaturedInput,
    @CurrentUser() staff: AuthUser,
  ) {
    return this.consultants.setFeatured(id, body.isFeatured, staff.id);
  }

  @ApiZodResponse('ConsultantFeeChangeAction', consultantFeeChangeActionResponseSchema)
  @Post(':id/fee-requests/:requestId/approve')
  approveFeeChange(@Param('id', new ParseUUIDPipe()) id: string, @Param('requestId', new ParseUUIDPipe()) requestId: string, @CurrentUser() staff: AuthUser) {
    return this.consultants.decideFeeChange(id, requestId, 'APPROVED', null, staff.id);
  }

  @ApiZodResponse('ConsultantFeeChangeAction', consultantFeeChangeActionResponseSchema)
  @Post(':id/fee-requests/:requestId/reject')
  rejectFeeChange(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @ZodBody(consultantFeeChangeDecisionSchema) body: ConsultantFeeChangeDecision,
    @CurrentUser() staff: AuthUser,
  ) {
    return this.consultants.decideFeeChange(id, requestId, 'REJECTED', body, staff.id);
  }
}
