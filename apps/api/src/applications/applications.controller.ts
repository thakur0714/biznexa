import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { applicationDetailSchema, createApplicationInput, draftApplicationSchema, updateApplicationFormInput, type CreateApplicationData, type UpdateApplicationFormInput } from '@biznexa/types';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { ApplicationsService } from './applications.service';

const uuid = new ParseUUIDPipe();
const NotFound = () => ApiResponse({ status: 404, description: 'No such application among yours (another customer’s application looks the same)' });

/** The signed-in customer's own applications. */
@ApiTags('applications')
@ApiBearerAuth()
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  /** "Continue to your details": a draft order + DRAFT application for a package (or the unpaid draft already started). */
  @ApiZodResponse('DraftApplication', draftApplicationSchema, 201)
  @ApiResponse({ status: 200, description: 'An unpaid draft for this package and business already existed and is returned (`resumed: true`)' })
  @ApiResponse({ status: 404, description: 'Package no longer offered, or no such business among yours' })
  @ApiResponse({ status: 409, description: 'The service has no application form yet' })
  @Post()
  async start(@ZodBody(createApplicationInput) body: CreateApplicationData, @CurrentUser() u: AuthUser, @Res({ passthrough: true }) res: Response) {
    const draft = await this.applications.startDraft(u.id, body);
    if (draft.resumed) res.status(200);
    return draft;
  }

  /** The form page (M3.9): loads the application to render and resume its form. */
  @ApiZodResponse('ApplicationDetail', applicationDetailSchema)
  @NotFound()
  @Get(':id')
  get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.applications.get(u.id, id);
  }

  /** Debounced autosave of the form's answers, or with `final: true` the full check before moving on (M3.9). Only while the application is a DRAFT. */
  @ApiZodResponse('ApplicationDetail', applicationDetailSchema)
  @NotFound()
  @ApiResponse({ status: 400, description: 'Answers do not fit the form (autosave: shape only; `final: true`: every rule), or a file is not one of yours. `errors[].field` is a path inside `formData`' })
  @ApiResponse({ status: 409, description: 'Not a draft any more' })
  @Patch(':id')
  update(@Param('id', uuid) id: string, @ZodBody(updateApplicationFormInput) body: UpdateApplicationFormInput, @CurrentUser() u: AuthUser) {
    return this.applications.updateFormData(u.id, id, body.formData, body.final);
  }
}
