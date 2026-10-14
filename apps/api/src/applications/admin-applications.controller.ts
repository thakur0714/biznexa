import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { adminApplicationListQuery, adminApplicationPageSchema, PERMS, type AdminApplicationListQuery } from '@biznexa/types';
import { AuthUser, CurrentUser, RequireAnyPermission } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../common/openapi';
import { AdminApplicationsService } from './admin-applications.service';

/** Staff applications list (M4.2): `applications.view_all` sees every application, `applications.view_assigned` only their own. */
@ApiTags('admin · applications')
@ApiBearerAuth()
@Controller('admin/applications')
export class AdminApplicationsController {
  constructor(private readonly applications: AdminApplicationsService) {}

  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @ApiZodResponse('AdminApplicationPage', adminApplicationPageSchema)
  @Get()
  list(@ZodQuery(adminApplicationListQuery) q: AdminApplicationListQuery, @CurrentUser() u: AuthUser) {
    return this.applications.list(u, q);
  }
}
