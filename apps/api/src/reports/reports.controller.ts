import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  type FileLinkResult,
  type ReportConsultantsResponse,
  type ReportCustomersResponse,
  type ReportDashboardResponse,
  type ReportDateRangeQuery,
  type ReportExportJob,
  type ReportExportRequest,
  type ReportSalesResponse,
  type ReportSearchesResponse,
  type ReportServicesResponse,
  type ReportSupportResponse,
  fileLinkSchema,
  reportConsultantsResponseSchema,
  reportCustomersResponseSchema,
  reportDashboardResponseSchema,
  reportDateRangeQuerySchema,
  reportExportJobSchema,
  reportExportRequestSchema,
  reportSalesResponseSchema,
  reportSearchesResponseSchema,
  reportServicesResponseSchema,
  reportSupportResponseSchema,
} from '@biznexa/types';
import { AuthUser, CurrentUser, PERMS, Public, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';
import type { Disposition } from '../files/files.service';
import { ReportsService } from './reports.service';

const linkQuery = z.object({
  disposition: z.enum(['attachment', 'inline']).default('attachment').describe('inline = open in the browser'),
});

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

  @ApiZodResponse('ReportServices', reportServicesResponseSchema)
  @Get('services')
  getServices(@ZodQuery(reportDateRangeQuerySchema) query: ReportDateRangeQuery): Promise<ReportServicesResponse> {
    return this.reportsService.getServicesReport(query);
  }

  @ApiZodResponse('ReportConsultants', reportConsultantsResponseSchema)
  @Get('consultants')
  getConsultants(@ZodQuery(reportDateRangeQuerySchema) query: ReportDateRangeQuery): Promise<ReportConsultantsResponse> {
    return this.reportsService.getConsultantsReport(query);
  }

  @ApiZodResponse('ReportSupport', reportSupportResponseSchema)
  @Get('support')
  getSupport(@ZodQuery(reportDateRangeQuerySchema) query: ReportDateRangeQuery): Promise<ReportSupportResponse> {
    return this.reportsService.getSupportReport(query);
  }

  @ApiZodResponse('ReportSearches', reportSearchesResponseSchema)
  @Get('searches')
  getSearches(@ZodQuery(reportDateRangeQuerySchema) query: ReportDateRangeQuery): Promise<ReportSearchesResponse> {
    return this.reportsService.getSearchesReport(query);
  }

  @ApiZodResponse('ReportExportJob', reportExportJobSchema, 201)
  @Post('export')
  exportReport(
    @ZodBody(reportExportRequestSchema) body: ReportExportRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<ReportExportJob> {
    return this.reportsService.enqueueExport(body, user.id);
  }

  @ApiZodResponse('FileLink', fileLinkSchema)
  @ApiResponse({ status: 404, description: 'Export not found' })
  @ApiResponse({ status: 409, description: 'Your export is still being prepared. Please try again shortly.' })
  @HttpCode(200)
  @Post('export/:id/link')
  linkExport(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodQuery(linkQuery) q: z.infer<typeof linkQuery>,
    @CurrentUser() user: AuthUser,
  ): Promise<FileLinkResult> {
    return this.reportsService.createExportLink(id, user, q.disposition as Disposition);
  }

  @Public()
  @ApiQuery({ name: 'e', description: 'Expiry (unix seconds)' })
  @ApiQuery({ name: 'd', required: false, enum: ['attachment', 'inline'] })
  @ApiQuery({ name: 's', description: 'Signature' })
  @ApiProduces('text/csv')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  @Get('export/:id/download')
  async downloadExport(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: { e?: string; d?: string; s?: string },
  ) {
    const { stream, size, disposition } = await this.reportsService.openExportLinked(id, q);
    return new StreamableFile(stream, { type: 'text/csv; charset=utf-8', length: size, disposition });
  }
}
