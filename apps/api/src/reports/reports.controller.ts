import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type ReportCustomersResponse,
  type ReportDashboardResponse,
  type ReportDateRangeQuery,
  type ReportSalesResponse,
  reportCustomersResponseSchema,
  reportDashboardResponseSchema,
  reportDateRangeQuerySchema,
  reportSalesResponseSchema,
} from '@biznexa/types';
import { PERMS, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../common/openapi';
import { ReportsService } from './reports.service';

@ApiTags('admin · reports')
@ApiBearerAuth()
@RequirePermissions(PERMS.REPORTS_VIEW)
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @ApiZodResponse('ReportDashboard', reportDashboardResponseSchema)
  @Get('dashboard')
  getDashboard(@ZodQuery(reportDateRangeQuerySchema) query: ReportDateRangeQuery): Promise<ReportDashboardResponse> {
    return this.reportsService.getDashboard(query);
  }

  @ApiZodResponse('ReportSales', reportSalesResponseSchema)
  @Get('sales')
  getSales(@ZodQuery(reportDateRangeQuerySchema) query: ReportDateRangeQuery): Promise<ReportSalesResponse> {
    return this.reportsService.getSalesReport(query);
  }

  @ApiZodResponse('ReportCustomers', reportCustomersResponseSchema)
  @Get('customers')
  getCustomers(@ZodQuery(reportDateRangeQuerySchema) query: ReportDateRangeQuery): Promise<ReportCustomersResponse> {
    return this.reportsService.getCustomersReport(query);
  }
}
