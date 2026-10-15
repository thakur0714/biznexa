import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  deviceTokenActionResponseSchema,
  markAllReadResponseSchema,
  notificationItemSchema,
  notificationListPageSchema,
  notificationListQuerySchema,
  notificationUnreadCountSchema,
  registerDeviceTokenInputSchema,
  unregisterDeviceTokenInputSchema,
  type NotificationListQuery,
  type RegisterDeviceTokenInput,
  type UnregisterDeviceTokenInput,
} from '@biznexa/types';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';
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

  /**
   * Registers a device token for push notifications. Owner only.
   */
  @ApiBearerAuth()
  @ApiZodResponse('DeviceTokenActionResponse', deviceTokenActionResponseSchema)
  @HttpCode(200)
  @Post(['devices/register', 'device-tokens/register', 'device-tokens'])
  registerDeviceToken(
    @ZodBody(registerDeviceTokenInputSchema) body: RegisterDeviceTokenInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notifications.registerDeviceToken(user.id, body);
  }

  /**
   * Unregisters a device token for push notifications. Owner only, else 403 or 404.
   */
  @ApiBearerAuth()
  @ApiZodResponse('DeviceTokenActionResponse', deviceTokenActionResponseSchema)
  @HttpCode(200)
  @Post(['devices/unregister', 'device-tokens/unregister'])
  unregisterDeviceToken(
    @ZodBody(unregisterDeviceTokenInputSchema) body: UnregisterDeviceTokenInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notifications.unregisterDeviceToken(user.id, body.token);
  }

  /**
   * Unregisters a device token via DELETE. Owner only, else 403 or 404.
   */
  @ApiBearerAuth()
  @ApiZodResponse('DeviceTokenActionResponse', deviceTokenActionResponseSchema)
  @HttpCode(200)
  @Delete(['devices/:token', 'device-tokens/:token'])
  deleteDeviceToken(
    @Param('token') token: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notifications.unregisterDeviceToken(user.id, token);
  }
}

