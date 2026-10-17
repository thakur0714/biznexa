import { Controller, Get } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  publicConsultantDirectoryQuerySchema,
  publicConsultantDirectorySchema,
  type PublicConsultantDirectoryQuery,
} from '@biznexa/types';
import { ApiZodResponse, ZodQuery } from '../common/openapi';
import { Public } from '../common/auth.decorators';
import { ConsultantsService } from './consultants.service';

@ApiTags('public · consultants')
@Public()
@Controller('public/consultants')
export class PublicConsultantsController {
  constructor(private readonly consultants: ConsultantsService) {}

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
}
