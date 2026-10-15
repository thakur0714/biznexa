import { Controller, Get, Post, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery, ZodBody } from '../common/openapi';
import { AdminApplicationDocumentsService } from './admin-application-documents.service';
import {
  adminDocumentReviewQueueQuery,
  AdminDocumentReviewQueueQuery,
  adminDocumentReviewQueuePageSchema,
  requestAdditionalDocumentInput,
  RequestAdditionalDocumentInput,
  rejectDocumentSchema,
  PERMS,
} from '@biznexa/types';
import { z } from 'zod';

const uuid = new ParseUUIDPipe();

@ApiTags('admin · applications')
@ApiBearerAuth()
@Controller('admin')
export class AdminApplicationDocumentsController {
  constructor(private readonly docs: AdminApplicationDocumentsService) {}

  @RequirePermissions(PERMS.DOCUMENTS_REVIEW)
  @ApiZodResponse('AdminDocumentReviewQueuePage', adminDocumentReviewQueuePageSchema)
  @Get('documents/review-queue')
  getReviewQueue(
    @ZodQuery(adminDocumentReviewQueueQuery) query: AdminDocumentReviewQueueQuery,
    @CurrentUser() u: AuthUser,
  ) {
    return this.docs.getReviewQueue(u, query);
  }

  @RequirePermissions(PERMS.DOCUMENTS_REVIEW)
  @Post('documents/:id/approve')
  approveDocument(
    @Param('id', uuid) id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.docs.approveDocument(id, u);
  }

  @RequirePermissions(PERMS.DOCUMENTS_REVIEW)
  @Post('documents/:id/reject')
  rejectDocument(
    @Param('id', uuid) id: string,
    @ZodBody(rejectDocumentSchema) body: z.infer<typeof rejectDocumentSchema>,
    @CurrentUser() u: AuthUser,
  ) {
    return this.docs.rejectDocument(id, body.reason, u);
  }

  @RequirePermissions(PERMS.DOCUMENTS_REVIEW)
  @Post('applications/:applicationId/documents')
  requestAdditionalDocument(
    @Param('applicationId', uuid) applicationId: string,
    @ZodBody(requestAdditionalDocumentInput) body: RequestAdditionalDocumentInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.docs.requestAdditionalDocument(applicationId, body, u);
  }
}
