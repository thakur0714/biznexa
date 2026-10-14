import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  markAllReadResponseSchema,
  notificationItemSchema,
  notificationListPageSchema,
  notificationListQuerySchema,
  notificationUnreadCountSchema,
  type NotificationListQuery,
} from '@biznexa/types';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../common/openapi';
import { NotificationsService } from './notifications.service';

const uuid = new ParseUUIDPipe();

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * The logged-in user's IN_APP notifications only, newest first,
   * cursor or page paging (default 20, max 50).
   */
  @ApiBearerAuth()
  @ApiZodResponse('NotificationListPage', notificationListPageSchema)
  @Get()
  list(@ZodQuery(notificationListQuerySchema) q: NotificationListQuery, @CurrentUser() user: AuthUser) {
    return this.notifications.list(user.id, q);
  }

  /**
   * Unread notification count for the logged-in user.
   */
  @ApiBearerAuth()
  @ApiZodResponse('NotificationUnreadCount', notificationUnreadCountSchema)
  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  /**
   * Sets readAt only on the user's unread rows.
   */
  @ApiBearerAuth()
  @ApiZodResponse('MarkAllReadResponse', markAllReadResponseSchema)
  @HttpCode(200)
  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  /**
   * Marks a notification as read. Owner only, else 404. Idempotent.
   */
  @ApiBearerAuth()
  @ApiZodResponse('NotificationItem', notificationItemSchema)
  @ApiResponse({ status: 404, description: 'Notification not found' })
  @HttpCode(200)
  @Post(':id/read')
  markRead(@Param('id', uuid) id: string, @CurrentUser() user: AuthUser) {
    return this.notifications.markRead(id, user.id);
  }
}
