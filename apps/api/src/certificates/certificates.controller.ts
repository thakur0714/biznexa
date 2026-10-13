import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import {
  adminCertificateListSchema,
  adminCertificateRowSchema,
  certificateOrgResultSchema,
  certificateVerifyResultSchema,
  certificationBodyListSchema,
  certificationBodySchema,
  createCertificationBodyInput,
  updateCertificationBodyInput,
  verifyCertificateSchema,
  type CreateCertificationBodyInput,
  type UpdateCertificationBodyInput,
} from '@biznexa/types';
import { CertificatesService, createCertificateInput, statusInput } from './certificates.service';
import { AuthUser, CurrentUser, PERMS, Public, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
const VERIFY_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('public · certificates')
@Public()
@Controller('public/certificates')
export class PublicCertificatesController {
  constructor(private readonly certs: CertificatesService) {}

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
  constructor(private readonly certs: CertificatesService) {}

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

  // Declared after the `bodies` routes: Express matches in order, and `:id` would swallow "bodies".
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

  @Get(':id/qr')
  qr(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.certs.qr(id);
  }

  @Get(':id/lookups')
  lookups(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.certs.lookups(id);
  }
}
