import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  createTicketInput,
  customerTicketListQuery,
  customerTicketListSchema,
  messageSchema,
  postTicketMessageInput,
  ticketDetailSchema,
  ticketSummarySchema,
  type CreateTicketInput,
  type CustomerTicketListQuery,
  type PostTicketMessageInput,
} from '@biznexa/types';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';
import { TicketsService } from './tickets.service';

const uuid = new ParseUUIDPipe();

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @ApiZodResponse('TicketSummary', ticketSummarySchema, 201)
  @ApiResponse({ status: 404, description: 'Application not found or does not belong to you' })
  @Post()
  create(@ZodBody(createTicketInput) body: CreateTicketInput, @CurrentUser() u: AuthUser) {
    return this.tickets.createCustomerTicket(u.id, body);
  }

  @ApiZodResponse('CustomerTicketListPage', customerTicketListSchema)
  @Get()
  list(@ZodQuery(customerTicketListQuery) q: CustomerTicketListQuery, @CurrentUser() u: AuthUser) {
    return this.tickets.listCustomer(u.id, q);
  }

  @ApiZodResponse('TicketDetail', ticketDetailSchema)
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  @Get(':id')
  get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.tickets.getCustomerTicket(u.id, id);
  }

  @ApiZodResponse('Message', messageSchema, 201)
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  @ApiResponse({ status: 409, description: 'Ticket is closed' })
  @Post(':id/messages')
  postMessage(
    @Param('id', uuid) id: string,
    @ZodBody(postTicketMessageInput) body: PostTicketMessageInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.tickets.postCustomerMessage(u.id, id, body);
  }
}
