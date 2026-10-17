import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  createDataRequestInput,
  dataRequestListSchema,
  dataRequestSchema,
  privacyOtpResponseSchema,
  type CreateDataRequestInput,
} from '@biznexa/types';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { PrivacyService } from './privacy.service';

/** The signed-in customer's data export and account deletion requests (DPDP, M5.12). */
@ApiTags('privacy')
@ApiBearerAuth()
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

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
}
