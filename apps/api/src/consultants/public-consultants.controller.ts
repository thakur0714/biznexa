import { Controller, Get, Param } from '@nestjs/common';
import { ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  publicConsultantDirectoryQuerySchema,
  publicConsultantDirectorySchema,
  publicConsultantProfileSchema,
  publicConsultantSlotsSchema,
  publicSlotsQuerySchema,
  type PublicConsultantDirectoryQuery,
  type PublicSlotsQuery,
} from '@biznexa/types';
import { ApiZodResponse, ZodQuery } from '../common/openapi';
import { Public } from '../common/auth.decorators';
import { ConsultantsService } from './consultants.service';
import { AvailabilityService } from './availability.service';

@ApiTags('public · consultants')
@Public()
@Controller('public/consultants')
export class PublicConsultantsController {
  constructor(private readonly consultants: ConsultantsService, private readonly availability: AvailabilityService) {}

  @ApiZodResponse('PublicConsultantDirectory', publicConsultantDirectorySchema)
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'city', required: false })
  @ApiQuery({ name: 'area', required: false })
  @ApiQuery({ name: 'minRating', required: false })
  @ApiQuery({ name: 'minExperience', required: false })
  @ApiQuery({ name: 'minFee', required: false, description: 'Paise' })
  @ApiQuery({ name: 'maxFee', required: false, description: 'Paise' })
  @ApiQuery({ name: 'language', required: false })
  @ApiQuery({ name: 'consultationType', required: false })
  @ApiQuery({ name: 'availableToday', required: false })
  @ApiQuery({ name: 'sort', required: false, enum: ['rating', 'experience', 'fee_low', 'fee_high'] })
  @Get()
  list(@ZodQuery(publicConsultantDirectoryQuerySchema) query: PublicConsultantDirectoryQuery) {
    return this.consultants.listPublic(query);
  }

  /** Bookable slots (IST) of an approved consultant, `from`..`to` inclusive (default: the next 7 days), at most 14 days. */
  @ApiZodResponse('PublicConsultantSlots', publicConsultantSlotsSchema)
  @ApiResponse({ status: 400, description: 'Bad dates, `to` before `from`, or more than 14 days' })
  @ApiResponse({ status: 404, description: 'No approved consultant with this slug' })
  @Get(':slug/slots')
  slots(@Param('slug') slug: string, @ZodQuery(publicSlotsQuerySchema) query: PublicSlotsQuery) {
    return this.availability.publicSlots(slug, query);
  }

  @ApiZodResponse('PublicConsultantProfile', publicConsultantProfileSchema)
  @ApiParam({ name: 'slug', description: 'Approved consultant profile slug' })
  @ApiResponse({ status: 404, description: 'No approved consultant with this slug' })
  @Get(':slug')
  profile(@Param('slug') slug: string) {
    return this.consultants.getPublic(slug);
  }
}
