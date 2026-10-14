import { Controller, Get, Post, Patch, Param, ParseUUIDPipe, Res, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { adminApplicationListQuery, adminApplicationPageSchema, adminApplicationDetailSchema, PERMS, type AdminApplicationListQuery, assigneeInputSchema, type AssigneeInput, bulkAssignInputSchema, type BulkAssignInput, eligibleStaffListSchema, applicationTransitionSchema, type ApplicationTransitionInput } from '@biznexa/types';
import { AuthUser, CurrentUser, RequireAnyPermission } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery, ZodBody } from '../common/openapi';
import { RequirePermissions } from '../common/auth.decorators';
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


  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @ApiZodResponse('EligibleStaffList', eligibleStaffListSchema)
  @Get('staff')
  getStaff() {
    return this.applications.getStaff();
  }

  @RequirePermissions(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_UPDATE)
  @Post('bulk-assign')
  bulkAssign(@ZodBody(bulkAssignInputSchema) body: BulkAssignInput, @CurrentUser() u: AuthUser) {
    return this.applications.bulkAssign(body, u);
  }

  @RequirePermissions(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_UPDATE)
  @Patch(':id/assignee')
  assign(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(assigneeInputSchema) body: AssigneeInput, @CurrentUser() u: AuthUser) {
    return this.applications.assign(id, body.assigneeId, u);
  }


  @RequirePermissions(PERMS.APPLICATIONS_UPDATE)
  @Post(':id/status')
  status(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(applicationTransitionSchema) body: ApplicationTransitionInput, @CurrentUser() u: AuthUser) {
    return this.applications.updateStatus(id, body, u);
  }

  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @ApiZodResponse('AdminApplicationDetail', adminApplicationDetailSchema)
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() u: AuthUser) {
    return this.applications.get(u, id);
  }

}
