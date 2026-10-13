import { Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sellerSettingsInput, sellerSettingsSchema, type SellerSettingsData, rejectionPresetsInput, rejectionPresetsSchema, type RejectionPresetsInput } from '@biznexa/types';
import { AuthUser, CurrentUser, PERMS, RequirePermissions, RequireAnyPermission } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { SettingsService } from './settings.service';

/** Seller details for GST and invoices (M3.14, D41). */
@ApiTags('admin · settings')
@ApiBearerAuth()
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @RequirePermissions(PERMS.SETTINGS_MANAGE)
  @ApiZodResponse('SellerSettings', sellerSettingsSchema)
  @Get('seller')
  seller() {
    return this.settings.seller();
  }

  /** Every field is sent each time; the state comes from the address. */
  @RequirePermissions(PERMS.SETTINGS_MANAGE)
  @ApiZodResponse('SellerSettings', sellerSettingsSchema)
  @Put('seller')
  update(@ZodBody(sellerSettingsInput) body: SellerSettingsData, @CurrentUser() u: AuthUser) {
    return this.settings.updateSeller(body, u.id);
  }

  @RequireAnyPermission(PERMS.DOCUMENTS_REVIEW, PERMS.SETTINGS_MANAGE)
  @ApiZodResponse('RejectionPresets', rejectionPresetsSchema)
  @Get('rejection-presets')
  rejectionPresets() {
    return this.settings.rejectionPresets();
  }

  @RequirePermissions(PERMS.SETTINGS_MANAGE)
  @ApiZodResponse('RejectionPresets', rejectionPresetsSchema)
  @Put('rejection-presets')
  updateRejectionPresets(@ZodBody(rejectionPresetsInput) body: RejectionPresetsInput, @CurrentUser() u: AuthUser) {
    return this.settings.updateRejectionPresets(body, u.id);
  }

}
