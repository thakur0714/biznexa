import { Controller, Get, Res, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { adminApplicationListQuery, adminApplicationPageSchema, PERMS, type AdminApplicationListQuery } from '@biznexa/types';
import { AuthUser, CurrentUser, RequireAnyPermission } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../common/openapi';
import { AdminApplicationsService } from './admin-applications.service';
import type { Response } from 'express';

/** Staff applications list (M4.2): `applications.view_all` sees every application, `applications.view_assigned` only their own. */
@ApiTags('admin · applications')
@ApiBearerAuth()
@Controller('admin/applications')
export class AdminApplicationsController {
  constructor(private readonly applications: AdminApplicationsService) {}

  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @Get('export')
  async exportCSV(@ZodQuery(adminApplicationListQuery) q: AdminApplicationListQuery, @CurrentUser() u: AuthUser, @Res() res: Response) {
    const csv = await this.applications.exportCSV(u, q);
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }).split('/').reverse().join('-');
    res.setHeader('Content-Disposition', `attachment; filename="applications-${today}.csv"`);
    
    res.send(csv);
  }

  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @ApiZodResponse('AdminApplicationPage', adminApplicationPageSchema)
  @Get()
  list(@ZodQuery(adminApplicationListQuery) q: AdminApplicationListQuery, @CurrentUser() u: AuthUser) {
    return this.applications.list(u, q);
  }
}
