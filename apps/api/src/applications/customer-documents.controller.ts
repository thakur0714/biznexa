import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { customerDocumentsQuery, customerDocumentsSchema, type CustomerDocumentsQuery } from '@biznexa/types';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../common/openapi';
import { ApplicationDocumentsService } from './application-documents.service';

/** The signed-in customer's documents across applications (M5.9). */
@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class CustomerDocumentsController {
  constructor(private readonly documents: ApplicationDocumentsService) {}

  @ApiZodResponse('CustomerDocuments', customerDocumentsSchema)
  @Get()
  list(@ZodQuery(customerDocumentsQuery) query: CustomerDocumentsQuery, @CurrentUser() user: AuthUser) {
    return this.documents.listForCustomer(user.id, query);
  }
}
