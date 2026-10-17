import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  availabilityExceptionInputSchema,
  availabilityUpdateInputSchema,
  consultantAvailabilitySchema,
  PERMS,
  type AvailabilityUpdateInput,
} from '@biznexa/types';
import type { z } from 'zod';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { AvailabilityService } from './availability.service';

/**
 * The signed-in consultant's own availability (M8.6). Consultants sign in to the portal like staff
 * (`admin.access`, so 2FA applies); a user without an approved consultant profile gets 403.
 */
@ApiTags('consultant · availability')
@ApiBearerAuth()
@RequirePermissions(PERMS.ADMIN_ACCESS)
@ApiResponse({ status: 403, description: 'Not signed in to the portal, or no approved consultant profile' })
@Controller('consultants/me/availability')
export class ConsultantAvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @ApiZodResponse('ConsultantAvailability', consultantAvailabilitySchema)
  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.availability.get(user.id);
  }

  /** Saves session length, buffer and minimum notice, and replaces the weekly windows. Date exceptions stay. */
  @ApiZodResponse('ConsultantAvailability', consultantAvailabilitySchema)
  @ApiResponse({ status: 400, description: 'Bad times, overlapping windows on one day, or an odd session length' })
  @Put()
  update(@ZodBody(availabilityUpdateInputSchema) body: AvailabilityUpdateInput, @CurrentUser() user: AuthUser) {
    return this.availability.update(user.id, body);
  }

  /** Blocks hours (or a whole day, without times) or adds extra hours on one date. */
  @ApiZodResponse('ConsultantAvailability', consultantAvailabilitySchema, 201)
  @ApiResponse({ status: 400, description: 'Bad date or times, or a date in the past' })
  @ApiResponse({ status: 409, description: 'The same exception is already saved' })
  @Post('exceptions')
  addException(@ZodBody(availabilityExceptionInputSchema) body: z.output<typeof availabilityExceptionInputSchema>, @CurrentUser() user: AuthUser) {
    return this.availability.addException(user.id, body);
  }

  @ApiZodResponse('ConsultantAvailability', consultantAvailabilitySchema)
  @ApiResponse({ status: 404, description: 'No such exception among yours' })
  @Delete('exceptions/:id')
  removeException(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.availability.removeException(user.id, id);
  }
}
