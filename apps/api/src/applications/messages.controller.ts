import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  markMessagesReadResponseSchema,
  messageListQuery,
  messageSchema,
  messageThreadPageSchema,
  messageUnreadCountSchema,
  PERMS,
  postMessageInput,
  type MessageListQuery,
  type PostMessageInput,
} from '@biznexa/types';
import {
  AuthUser,
  CurrentUser,
  CustomerOnly,
  RequireAnyPermission,
} from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';
import { MessagesService } from './messages.service';

const uuid = new ParseUUIDPipe();

/** Application messaging threads (M4.11) */
@ApiTags('applications')
@ApiBearerAuth()
@Controller()
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @ApiZodResponse('MessageThreadPage', messageThreadPageSchema)
  @Get('admin/applications/:applicationId/messages')
  listStaff(
    @Param('applicationId', uuid) applicationId: string,
    @ZodQuery(messageListQuery) q: MessageListQuery,
    @CurrentUser() u: AuthUser,
  ) {
    return this.messages.listStaff(applicationId, q, u);
  }

  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @ApiZodResponse('Message', messageSchema, 201)
  @Post('admin/applications/:applicationId/messages')
  postStaff(
    @Param('applicationId', uuid) applicationId: string,
    @ZodBody(postMessageInput) body: PostMessageInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.messages.postStaff(applicationId, body, u);
  }

  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @ApiZodResponse('MarkMessagesReadResponse', markMessagesReadResponseSchema)
  @HttpCode(200)
  @Post('admin/applications/:applicationId/messages/read')
  markReadStaff(
    @Param('applicationId', uuid) applicationId: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.messages.markReadStaff(applicationId, u);
  }

  @RequireAnyPermission(PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED)
  @ApiZodResponse('MessageUnreadCount', messageUnreadCountSchema)
  @Get('admin/applications/:applicationId/messages/unread-count')
  unreadCountStaff(
    @Param('applicationId', uuid) applicationId: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.messages.unreadCountStaff(applicationId, u);
  }

  @ApiZodResponse('MessageThreadPage', messageThreadPageSchema)
  @Get('applications/:id/messages')
  @CustomerOnly()
  listCustomer(
    @Param('id', uuid) id: string,
    @ZodQuery(messageListQuery) q: MessageListQuery,
    @CurrentUser() u: AuthUser,
  ) {
    return this.messages.listCustomer(id, q, u);
  }

  @ApiZodResponse('Message', messageSchema, 201)
  @Post('applications/:id/messages')
  @CustomerOnly()
  postCustomer(
    @Param('id', uuid) id: string,
    @ZodBody(postMessageInput) body: PostMessageInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.messages.postCustomer(id, body, u);
  }

  @ApiZodResponse('MarkMessagesReadResponse', markMessagesReadResponseSchema)
  @HttpCode(200)
  @Post('applications/:id/messages/read')
  @CustomerOnly()
  markReadCustomer(
    @Param('id', uuid) id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.messages.markReadCustomer(id, u);
  }

  @ApiZodResponse('MessageUnreadCount', messageUnreadCountSchema)
  @Get('applications/:id/messages/unread-count')
  @CustomerOnly()
  unreadCountCustomer(
    @Param('id', uuid) id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.messages.unreadCountCustomer(id, u);
  }
}
