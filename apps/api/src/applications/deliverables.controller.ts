import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, CustomerOnly, RequireAnyPermission, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { DeliverablesService } from './deliverables.service';
import {
  AddDeliverableInput,
  addDeliverableInputSchema,
  deliverableListSchema,
  deliverableSchema,
  PERMS,
} from '@biznexa/types';

const uuid = new ParseUUIDPipe();

@ApiTags('applications')
@ApiBearerAuth()
@Controller()
export class DeliverablesController {
  constructor(private readonly deliverables: DeliverablesService) {}

  @RequirePermissions(PERMS.APPLICATIONS_UPDATE)
  @ApiZodResponse('Deliverable', deliverableSchema, 201)
  @Post('admin/applications/:applicationId/deliverables')
  addDeliverable(
    @Param('applicationId', uuid) applicationId: string,
    @ZodBody(addDeliverableInputSchema) body: AddDeliverableInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.deliverables.addDeliverable(applicationId, body, u);
  }

  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @ApiZodResponse('DeliverableList', deliverableListSchema)
  @Get('admin/applications/:applicationId/deliverables')
  listDeliverablesAdmin(
    @Param('applicationId', uuid) applicationId: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.deliverables.listDeliverablesAdmin(applicationId, u);
  }

  @ApiZodResponse('DeliverableList', deliverableListSchema)
  @Get('applications/:id/deliverables')
  @CustomerOnly()
  listDeliverablesCustomer(
    @Param('id', uuid) id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.deliverables.listDeliverablesCustomer(id, u);
  }
}
