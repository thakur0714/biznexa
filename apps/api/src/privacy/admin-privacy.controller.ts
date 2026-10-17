import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  adminDataRequestListQuery,
  adminDataRequestListSchema,
  adminDataRequestRowSchema,
  rejectDataRequestInput,
  type AdminDataRequestListQuery,
  type RejectDataRequestInput,
} from '@biznexa/types';
import { AuthUser, CurrentUser, PERMS, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';
import { AdminPrivacyService } from './admin-privacy.service';

/** The DPDP request queue (M5.12): `privacy.manage` (Admin by default). */
@ApiTags('admin · privacy')
@ApiBearerAuth()
@RequirePermissions(PERMS.PRIVACY_MANAGE)
@Controller('admin/privacy/requests')
export class AdminPrivacyController {
  constructor(private readonly privacy: AdminPrivacyService) {}

  @ApiZodResponse('AdminDataRequestList', adminDataRequestListSchema)
  @Get()
  list(@ZodQuery(adminDataRequestListQuery) q: AdminDataRequestListQuery) {
    return this.privacy.list(q);
  }

  /** Anonymises the account (D61). */
  @ApiZodResponse('AdminDataRequestRow', adminDataRequestRowSchema)
  @ApiResponse({ status: 409, description: 'Not a pending deletion, or an application is in progress, a balance is due or a booking is upcoming' })
  @HttpCode(200)
  @Post(':id/approve')
  approve(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() staff: AuthUser) {
    return this.privacy.approve(id, staff.id);
  }

  @ApiZodResponse('AdminDataRequestRow', adminDataRequestRowSchema)
  @ApiResponse({ status: 409, description: 'Not pending' })
  @HttpCode(200)
  @Post(':id/reject')
  reject(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(rejectDataRequestInput) body: RejectDataRequestInput, @CurrentUser() staff: AuthUser) {
    return this.privacy.reject(id, body, staff.id);
  }
}
