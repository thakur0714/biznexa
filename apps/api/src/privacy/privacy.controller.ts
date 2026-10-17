import { Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  createDataRequestInput,
  dataRequestListSchema,
  dataRequestSchema,
  fileLinkSchema,
  privacyOtpResponseSchema,
  type CreateDataRequestInput,
} from '@biznexa/types';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { PrivacyService } from './privacy.service';
import { DataExportService } from './data-export.service';

/** The signed-in customer's data export and account deletion requests (DPDP, M5.12). */
@ApiTags('privacy')
@ApiBearerAuth()
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService, private readonly exports: DataExportService) {}

  @ApiZodResponse('DataRequestList', dataRequestListSchema)
  @Get('requests')
  list(@CurrentUser() user: AuthUser) {
    return this.privacy.list(user.id);
  }

  @ApiZodResponse('DataRequest', dataRequestSchema, 201)
  @ApiResponse({ status: 400, description: 'Deletion: wrong password or code' })
  @ApiResponse({ status: 403, description: 'Deletion: staff and consultant accounts' })
  @ApiResponse({ status: 409, description: 'A request of this type is already open' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('requests')
  create(@ZodBody(createDataRequestInput) body: CreateDataRequestInput, @CurrentUser() user: AuthUser) {
    return this.privacy.create(user.id, body);
  }

  /** Sends the one-time code that confirms a deletion request (to the mobile, else the email). */
  @ApiZodResponse('PrivacyOtp', privacyOtpResponseSchema)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('otp')
  otp(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.privacy.sendOtp(user.id, req.ip);
  }

  /** A 5-minute signed link for the customer's own finished export. */
  @ApiZodResponse('FileLink', fileLinkSchema)
  @ApiResponse({ status: 404, description: 'No such export among yours (another customer’s looks the same)' })
  @ApiResponse({ status: 409, description: 'Still being prepared' })
  @ApiResponse({ status: 410, description: 'Expired and deleted — ask for a new export' })
  @HttpCode(200)
  @Post('requests/:id/link')
  link(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.exports.createLink(user.id, id);
  }
}

/** The signed export link itself: no login, the signature and expiry are the permission. */
@ApiTags('privacy')
@Controller('data-exports')
export class DataExportsController {
  constructor(private readonly exports: DataExportService) {}

  @Public()
  @ApiQuery({ name: 'e', description: 'Expiry (unix seconds)' })
  @ApiQuery({ name: 'd', required: false, enum: ['attachment'] })
  @ApiQuery({ name: 's', description: 'Signature' })
  @ApiProduces('application/zip')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  @Get(':id/download')
  async download(@Param('id', new ParseUUIDPipe()) id: string, @Query() q: { e?: string; d?: string; s?: string }) {
    const { stream, size, disposition } = await this.exports.openLinked(id, q);
    return new StreamableFile(stream, { type: 'application/zip', length: size, disposition });
  }
}
