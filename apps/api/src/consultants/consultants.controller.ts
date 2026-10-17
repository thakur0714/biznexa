import { Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { consultantApplicationInputSchema, consultantApplicationResponseSchema, consultantOwnProfileSchema, consultantProfileInputSchema, PERMS, type ConsultantApplicationInput, type ConsultantProfileInput } from '@biznexa/types';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { ConsultantsService } from './consultants.service';

@ApiTags('consultants')
@ApiBearerAuth()
@Controller('consultants')
export class ConsultantsController {
  constructor(private readonly consultants: ConsultantsService) {}

  @ApiZodResponse('ConsultantApplicationResponse', consultantApplicationResponseSchema, 201)
  @ApiResponse({ status: 400, description: 'A proof file is missing, duplicated, or does not belong to the applicant.' })
  @ApiResponse({ status: 409, description: 'The user already has a consultant application.' })
  @Post()
  apply(
    @CurrentUser() user: AuthUser,
    @ZodBody(consultantApplicationInputSchema) body: ConsultantApplicationInput,
  ) {
    return this.consultants.apply(user.id, body);
  }

  @ApiZodResponse('ConsultantOwnProfile', consultantOwnProfileSchema)
  @RequirePermissions(PERMS.ADMIN_ACCESS)
  @Get('me/profile')
  ownProfile(@CurrentUser() user: AuthUser) {
    return this.consultants.getOwnProfile(user.id);
  }

  @ApiZodResponse('ConsultantOwnProfile', consultantOwnProfileSchema)
  @RequirePermissions(PERMS.ADMIN_ACCESS)
  @Put('me/profile')
  updateOwnProfile(@CurrentUser() user: AuthUser, @ZodBody(consultantProfileInputSchema) body: ConsultantProfileInput) {
    return this.consultants.updateOwnProfile(user.id, body);
  }
}
