import { Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sellerSettingsInput, sellerSettingsSchema, type SellerSettingsData } from '@biznexa/types';
import { AuthUser, CurrentUser, PERMS, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { SettingsService } from './settings.service';

/** Seller details for GST and invoices (M3.14, D41). */
@ApiTags('admin · settings')
@ApiBearerAuth()
@RequirePermissions(PERMS.SETTINGS_MANAGE)
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @ApiZodResponse('SellerSettings', sellerSettingsSchema)
  @Get('seller')
  seller() {
    return this.settings.seller();
  }

  /** Every field is sent each time; the state comes from the address. */
  @ApiZodResponse('SellerSettings', sellerSettingsSchema)
  @Put('seller')
  update(@ZodBody(sellerSettingsInput) body: SellerSettingsData, @CurrentUser() u: AuthUser) {
    return this.settings.updateSeller(body, u.id);
  }
}
