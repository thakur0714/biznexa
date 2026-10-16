import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { attachDocumentInput, documentChecklistSchema, type AttachDocumentInput } from '@biznexa/types';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { ApplicationDocumentsService } from './application-documents.service';

const uuid = new ParseUUIDPipe();

/** The document step of the signed-in customer's own application (M3.10). */
@ApiTags('applications')
@ApiBearerAuth()
@Controller('applications/:id/documents')
export class ApplicationDocumentsController {
  constructor(private readonly documents: ApplicationDocumentsService) {}

  /** The checklist: the service's documents for this package, each with its newest upload and earlier versions. */
  @ApiZodResponse('DocumentChecklist', documentChecklistSchema)
  @ApiResponse({ status: 404, description: 'No such application among yours (another customer’s application looks the same)' })
  @Get()
  checklist(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.documents.checklist(u.id, id);
  }

  /**
   * Attach a file uploaded with `POST /api/files?requirementId={requirementId}` to that checklist item.
   * The first upload is version 1; a replacement is the next version and earlier versions are kept.
   */
  /**
   * Attach a file uploaded with `POST /api/files` (no `requirementId`) to a document staff asked for (M4.8,
   * listed under `additional`). A replacement is the next version; earlier versions are kept.
   */
  @ApiZodResponse('DocumentChecklist', documentChecklistSchema, 201)
  @ApiResponse({ status: 400, description: 'The file is not yours, was uploaded for a checklist document, is already attached, or had a virus (`errors[].field` is `fileId`)' })
  @ApiResponse({ status: 404, description: 'No such application among yours, or no such request on it' })
  @ApiResponse({ status: 409, description: 'The application is past the document step, or this document is under review or approved' })
  @Post('additional/:requestId')
  attachAdditional(
    @Param('id', uuid) id: string,
    @Param('requestId', uuid) requestId: string,
    @ZodBody(attachDocumentInput) body: AttachDocumentInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.documents.attachAdditional(u.id, id, requestId, body.fileId);
  }

  @ApiZodResponse('DocumentChecklist', documentChecklistSchema, 201)
  @ApiResponse({ status: 400, description: 'The file is not yours, was uploaded for another document, is already attached, or had a virus (`errors[].field` is `fileId`)' })
  @ApiResponse({ status: 404, description: 'No such application among yours, or the document is not on its checklist' })
  @ApiResponse({ status: 409, description: 'The application is past the document step, or this document is under review or approved' })
  @Post(':requirementId')
  attach(
    @Param('id', uuid) id: string,
    @Param('requirementId', uuid) requirementId: string,
    @ZodBody(attachDocumentInput) body: AttachDocumentInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.documents.attach(u.id, id, requirementId, body.fileId);
  }
}
