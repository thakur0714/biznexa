import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  adminTicketDetailSchema,
  adminTicketListQuery,
  adminTicketListSchema,
  adminTicketSummarySchema,
  eligibleStaffListSchema,
  messageSchema,
  PERMS,
  postTicketMessageInput,
  updateTicketAssigneeInput,
  updateTicketInput,
  updateTicketPriorityInput,
  updateTicketStatusInput,
  type AdminTicketListQuery,
  type PostTicketMessageInput,
  type UpdateTicketAssigneeInput,
  type UpdateTicketInput,
  type UpdateTicketPriorityInput,
  type UpdateTicketStatusInput,
} from '@biznexa/types';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';
import { TicketsService } from './tickets.service';

const uuid = new ParseUUIDPipe();

@ApiTags('admin-tickets')
@ApiBearerAuth()
@RequirePermissions(PERMS.TICKETS_MANAGE)
@Controller('admin/tickets')
export class AdminTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @ApiZodResponse('EligibleStaffList', eligibleStaffListSchema)
  @Get('staff')
  getStaff() {
    return this.tickets.getStaff();
  }

  @ApiZodResponse('AdminTicketListPage', adminTicketListSchema)
  @Get()
  list(@ZodQuery(adminTicketListQuery) q: AdminTicketListQuery) {
    return this.tickets.listStaff(q);
  }

  @ApiZodResponse('AdminTicketDetail', adminTicketDetailSchema)
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.tickets.getStaffTicket(id);
  }

  @ApiZodResponse('AdminTicketSummary', adminTicketSummarySchema)
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  @ApiResponse({ status: 409, description: 'Invalid ticket status transition' })
  @Patch(':id/status')
  updateStatus(
    @Param('id', uuid) id: string,
    @ZodBody(updateTicketStatusInput) body: UpdateTicketStatusInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.tickets.updateStatus(id, body.status, u.id);
  }

  @ApiZodResponse('AdminTicketSummary', adminTicketSummarySchema)
  @ApiResponse({ status: 400, description: 'Selected user is not eligible for tickets' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  @Patch(':id/assignee')
  updateAssignee(
    @Param('id', uuid) id: string,
    @ZodBody(updateTicketAssigneeInput) body: UpdateTicketAssigneeInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.tickets.updateAssignee(id, body.assignedToId, u.id);
  }

  @ApiZodResponse('AdminTicketSummary', adminTicketSummarySchema)
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  @Patch(':id/priority')
  updatePriority(
    @Param('id', uuid) id: string,
    @ZodBody(updateTicketPriorityInput) body: UpdateTicketPriorityInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.tickets.updatePriority(id, body.priority, u.id);
  }

  @ApiZodResponse('AdminTicketSummary', adminTicketSummarySchema)
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  @ApiResponse({ status: 409, description: 'Invalid ticket status transition' })
  @Patch(':id')
  update(
    @Param('id', uuid) id: string,
    @ZodBody(updateTicketInput) body: UpdateTicketInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.tickets.updateTicket(id, body, u.id);
  }

  @ApiZodResponse('Message', messageSchema, 201)
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  @ApiResponse({ status: 409, description: 'Ticket is closed' })
  @Post(':id/reply')
  postReply(
    @Param('id', uuid) id: string,
    @ZodBody(postTicketMessageInput) body: PostTicketMessageInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.tickets.postStaffReply(id, body, u.id);
  }

  @ApiZodResponse('Message', messageSchema, 201)
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  @ApiResponse({ status: 409, description: 'Ticket is closed' })
  @Post(':id/messages')
  postMessages(
    @Param('id', uuid) id: string,
    @ZodBody(postTicketMessageInput) body: PostTicketMessageInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.tickets.postStaffReply(id, body, u.id);
  }
}
