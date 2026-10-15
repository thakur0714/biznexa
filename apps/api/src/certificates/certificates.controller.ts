import { Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import {
  adminCertificateListSchema,
  adminCertificateRowSchema,
  certificateImportInputSchema,
  certificateImportPreviewResponseSchema,
  certificateImportResponseSchema,
  certificateOrgResultSchema,
  certificateVerifyResultSchema,
  certificationBodyListSchema,
  certificationBodySchema,
  createCertificationBodyInput,
  fileLinkSchema,
  updateCertificationBodyInput,
  verifyCertificateSchema,
  type CertificateImportInput,
  type CreateCertificationBodyInput,
  type UpdateCertificationBodyInput,
} from '@biznexa/types';
import { CSV_SAMPLE_TEMPLATE, generateCsvErrorReport } from './certificate-csv';
import { CertificatesService, createCertificateInput, statusInput } from './certificates.service';
import { CertificatePdfService } from './certificate-pdf.service';
import { AuthUser, CurrentUser, PERMS, Public, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
const VERIFY_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('public · certificates')
@Public()
@Controller('public/certificates')
export class PublicCertificatesController {
  constructor(
    private readonly certs: CertificatesService,
    private readonly pdfService: CertificatePdfService,
  ) {}

  @Throttle(VERIFY_LIMIT)
  @ApiZodResponse('CertificateVerifyResult', certificateVerifyResultSchema)
  @Get('verify')
  verify(@ZodQuery(verifyCertificateSchema.and(z.object({ t: z.string().max(32).optional().describe('QR signature') }))) q: { number?: string; id?: string; t?: string }, @Req() req: Request) {
    return this.certs.verify(q, meta(req));
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiQuery({ name: 'organization', description: 'At least 3 characters of the organisation name' })
  @ApiZodResponse('CertificateOrgResult', certificateOrgResultSchema)
  @Get('search')
  search(@Query('organization') organization = '', @Req() req: Request) {
    return this.certs.searchByOrganization(String(organization).slice(0, 100), meta(req));
  }

  @Get(':id/download')
  @ApiProduces('application/pdf')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'public, max-age=3600')
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  async downloadPublic(
    @Param('id') id: string,
    @Query('disposition') disposition?: 'attachment' | 'inline',
  ) {
    const { stream, size, disposition: cd } = await this.pdfService.openPublic(id, disposition ?? 'attachment');
    return new StreamableFile(stream, { type: 'application/pdf', length: size, disposition: cd });
  }
}

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'WITHDRAWN', 'EXPIRED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

@ApiTags('admin · certificates')
@ApiBearerAuth()
@RequirePermissions(PERMS.CERTIFICATES_MANAGE)
@Controller('admin/certificates')
export class AdminCertificatesController {
  constructor(
    private readonly certs: CertificatesService,
    private readonly pdfService: CertificatePdfService,
  ) {}

  @ApiZodResponse('AdminCertificateList', adminCertificateListSchema)
  @Get()
  list(@ZodQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.certs.list(q);
  }

  @ApiZodResponse('CertificationBodyList', certificationBodyListSchema)
  @Get('bodies')
  bodies() {
    return this.certs.bodies();
  }

  @ApiZodResponse('CertificationBodyRow', certificationBodySchema, 201)
  @Post('bodies')
  createBody(@ZodBody(createCertificationBodyInput) body: CreateCertificationBodyInput, @CurrentUser() u: AuthUser) {
    return this.certs.createBody(body, u.id);
  }

  @ApiZodResponse('CertificationBodyRow', certificationBodySchema)
  @Patch('bodies/:id')
  updateBody(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(updateCertificationBodyInput) body: UpdateCertificationBodyInput, @CurrentUser() u: AuthUser) {
    return this.certs.updateBody(id, body, u.id);
  }

  @Delete('bodies/:id')
  deleteBody(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() u: AuthUser) {
    return this.certs.deleteBody(id, u.id);
  }

  @Get('import/template')
  @ApiProduces('text/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="certificate-import-template.csv"')
  getImportTemplate() {
    return CSV_SAMPLE_TEMPLATE;
  }

  @ApiZodResponse('CertificateImportPreviewResponse', certificateImportPreviewResponseSchema)
  @Post('import/preview')
  previewImport(@ZodBody(certificateImportInputSchema) body: CertificateImportInput) {
    return this.certs.previewImport(body.csv);
  }

  @ApiZodResponse('CertificateImportResponse', certificateImportResponseSchema)
  @Post('import')
  importCertificates(@ZodBody(certificateImportInputSchema) body: CertificateImportInput, @CurrentUser() u: AuthUser) {
    return this.certs.importCertificates(body.csv, u.id);
  }

  @Post('import/error-report')
  @ApiProduces('text/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="certificate-import-errors.csv"')
  downloadErrorReport(
    @ZodBody(
      z.object({
        errors: z.array(
          z.object({
            rowNumber: z.number().int(),
            certificateNumber: z.string().optional(),
            organizationName: z.string().optional(),
            field: z.string().optional(),
            message: z.string(),
          }),
        ),
      }),
    )
    body: {
      errors: Array<{
        rowNumber: number;
        certificateNumber?: string;
        organizationName?: string;
        field?: string;
        message: string;
      }>;
    },
  ) {
    return generateCsvErrorReport(body.errors);
  }

  // Declared after the `bodies` and `import` routes: Express matches in order, and `:id` would swallow subpaths.
  @ApiZodResponse('AdminCertificateRow', adminCertificateRowSchema)
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.certs.get(id);
  }

  @Post()
  create(@ZodBody(createCertificateInput) body: z.infer<typeof createCertificateInput>, @CurrentUser() u: AuthUser) {
    return this.certs.create(body, u.id);
  }

  @Patch(':id/status')
  status(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(statusInput) body: z.infer<typeof statusInput>, @CurrentUser() u: AuthUser) {
    return this.certs.changeStatus(id, body, u.id);
  }

  @Patch(':id/public-download')
  togglePublicDownload(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(z.object({ showPdfPublicly: z.boolean() })) body: { showPdfPublicly: boolean },
    @CurrentUser() u: AuthUser,
  ) {
    return this.pdfService.togglePublicDownload(id, body.showPdfPublicly, u.id);
  }

  @Post(':id/pdf')
  attachPdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(z.object({ fileId: z.string().uuid() })) body: { fileId: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.pdfService.attachUploadedPdf(id, body.fileId, u.id);
  }

  @Post(':id/pdf/regenerate')
  regeneratePdf(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() u: AuthUser) {
    return this.pdfService.regenerate(id, u.id);
  }

  @Get(':id/qr')
  qr(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.certs.qr(id);
  }

  @Get(':id/lookups')
  lookups(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.certs.lookups(id);
  }
}

const certLinkQuery = z.object({
  disposition: z.enum(['attachment', 'inline']).default('attachment').describe('inline = open in the browser'),
});

@ApiTags('certificates')
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly pdfService: CertificatePdfService) {}

  @ApiBearerAuth()
  @ApiZodResponse('FileLink', fileLinkSchema)
  @ApiResponse({ status: 404, description: 'No such certificate among yours' })
  @ApiResponse({ status: 409, description: 'The certificate PDF is still being generated — try again shortly' })
  @HttpCode(200)
  @Post(':id/link')
  link(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodQuery(certLinkQuery) q: z.infer<typeof certLinkQuery>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pdfService.createLink(id, user, q.disposition);
  }

  @Public()
  @ApiQuery({ name: 'e', description: 'Expiry (unix seconds)' })
  @ApiQuery({ name: 'd', required: false, enum: ['attachment', 'inline'] })
  @ApiQuery({ name: 's', description: 'Signature' })
  @ApiProduces('application/pdf')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  @Get(':id/download')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: { e?: string; d?: string; s?: string },
  ) {
    const { stream, size, disposition } = await this.pdfService.openLinked(id, q);
    return new StreamableFile(stream, { type: 'application/pdf', length: size, disposition });
  }
}
