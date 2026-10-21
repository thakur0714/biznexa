
import { Controller, Get, Post, Put, Delete, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { internalNoteSchema, internalNoteListSchema, createInternalNoteInput, updateInternalNoteInput, type CreateInternalNoteInput, type UpdateInternalNoteInput, PERMS } from '@biznexa/types';
import { AuthUser, CurrentUser, RequireAnyPermission } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { InternalNotesService } from './internal-notes.service';

const uuid = new ParseUUIDPipe();

/** Internal notes (M4.10) */
@ApiTags('admin · applications')
@ApiBearerAuth()
@Controller('admin/applications')
export class InternalNotesController {
  constructor(private readonly notes: InternalNotesService) {}

  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @ApiZodResponse('InternalNoteList', internalNoteListSchema)
  @Get(':applicationId/notes')
  async list(@Param('applicationId', uuid) applicationId: string, @CurrentUser() u: AuthUser) {
    return this.notes.list(applicationId, u);
  }

  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @ApiZodResponse('InternalNote', internalNoteSchema, 201)
  @Post(':applicationId/notes')
  async create(@Param('applicationId', uuid) applicationId: string, @ZodBody(createInternalNoteInput) body: CreateInternalNoteInput, @CurrentUser() u: AuthUser) {
    return this.notes.create(applicationId, body, u);
  }

  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @ApiZodResponse('InternalNote', internalNoteSchema)
  @Put(':applicationId/notes/:id')
  async update(@Param('applicationId', uuid) applicationId: string, @Param('id', uuid) id: string, @ZodBody(updateInternalNoteInput) body: UpdateInternalNoteInput, @CurrentUser() u: AuthUser) {
    return this.notes.update(applicationId, id, body, u);
  }

  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @Delete(':applicationId/notes/:id')
  async remove(@Param('applicationId', uuid) applicationId: string, @Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.notes.remove(applicationId, id, u);
  }
}
