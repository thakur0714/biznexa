import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
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
  customerCertificateListSchema,
  customerCertificateRowSchema,
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

interface RateLimitBucket {
  count: number;
  resetAt: number;
}
export const verifyRateLimitMap = new Map<string, RateLimitBucket>();

export function checkVerifyRateLimit(key: string, limit: number, windowMs = 60_000): { remaining: number; resetAt: number } {
  const now = Date.now();
  // One bucket per IP: drop expired ones so a flood of addresses cannot grow the map forever.
  if (verifyRateLimitMap.size > 10_000) {
    for (const [k, b] of verifyRateLimitMap) if (b.resetAt <= now) verifyRateLimitMap.delete(k);
  }
  const bucket = verifyRateLimitMap.get(key);
  if (!bucket || bucket.resetAt <= now) {
    verifyRateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { remaining: limit - 1, resetAt: now + windowMs };
  }
  if (bucket.count >= limit) {
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please wait before making more requests, or supply an authorized API key.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  bucket.count++;
  return { remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

export function validateVerifyApiKey(key?: string): boolean {
  if (!key) return false;
  // Only keys we handed out; with none configured, every key is refused.
  const keys = env().CERT_VERIFY_API_KEYS.split(',').map((k) => k.trim()).filter(Boolean);
  return keys.includes(key);
}

@ApiTags('public · certificates')
@Public()
@Controller('public/certificates')
export class PublicCertificatesController {
  constructor(
    private readonly certs: CertificatesService,
    private readonly pdfService: CertificatePdfService,
  ) {}

  // No @Throttle here: it would cap partner keys at 30/min too. checkVerifyRateLimit handles both tiers.
  @SkipThrottle()
  @ApiHeader({ name: 'X-API-Key', required: false, description: 'Optional partner API key for higher rate limits' })
  @ApiQuery({ name: 'apiKey', required: false, description: 'Optional partner API key (can also be passed as X-API-Key header)' })
  @ApiZodResponse('CertificateVerifyResult', certificateVerifyResultSchema)
  @Get('verify')
  async verify(
    @ZodQuery(
      verifyCertificateSchema.and(
        z.object({
          t: z.string().max(32).optional().describe('QR signature'),
          apiKey: z.string().max(128).optional().describe('Optional API key'),
          key: z.string().max(128).optional().describe('Optional API key alias'),
        }),
      ),
    )
    q: { number?: string; id?: string; t?: string; apiKey?: string; key?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawApiKey = (req.headers['x-api-key'] as string | undefined) || q.apiKey || q.key;
    let isPartnerApi = false;

    if (rawApiKey) {
      if (!validateVerifyApiKey(rawApiKey)) {
        throw new UnauthorizedException('Invalid API key');
      }
      isPartnerApi = true;
    }

    const rateKey = isPartnerApi ? `key:${rawApiKey}` : `ip:${req.ip || 'anonymous'}`;
    const limit = isPartnerApi ? 300 : 30;
    const { remaining, resetAt } = checkVerifyRateLimit(rateKey, limit);

    res.setHeader('X-RateLimit-Limit', limit.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000).toString());

    return this.certs.verify(q, {
      ...meta(req),
      apiKey: rawApiKey,
      isPartnerApi,
    });
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiQuery({ name: 'organization', description: 'At least 3 characters of the organisation name' })
  @ApiZodResponse('CertificateOrgResult', certificateOrgResultSchema)
  @Get('search')
  search(@Query('organization') organization = '', @Req() req: Request) {
    return this.certs.searchByOrganization(String(organization).slice(0, 100), meta(req));
  }

  @Throttle(VERIFY_LIMIT)
  @Get(':id/download')
  @ApiProduces('application/pdf')
  @Header('X-Content-Type-Options', 'nosniff')
  // Short cache: withdrawing a certificate or turning public download off must take effect quickly.
  @Header('Cache-Control', 'public, max-age=300')
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
  constructor(
    private readonly certs: CertificatesService,
    private readonly pdfService: CertificatePdfService,
  ) {}

  @ApiBearerAuth()
  @ApiZodResponse('CustomerCertificateList', customerCertificateListSchema)
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.certs.listForCustomer(user);
  }

  @ApiBearerAuth()
  @ApiZodResponse('CustomerCertificateRow', customerCertificateRowSchema)
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.certs.getForCustomer(id, user);
  }

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
