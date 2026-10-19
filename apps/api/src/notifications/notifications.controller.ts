import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
  userNotificationPreferencesSchema,
  type NotificationListQuery,
  type RegisterDeviceTokenInput,
  type UnregisterDeviceTokenInput,
  type UserNotificationPreferences,
} from '@biznexa/types';
import { AuthUser, CurrentUser, SignedIn } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';

const uuid = new ParseUUIDPipe();

@ApiTags('notifications')
@SignedIn()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  /**
   * The logged-in user's notification preferences (M5.11).
   */
  @ApiBearerAuth()
  @ApiZodResponse('UserNotificationPreferences', userNotificationPreferencesSchema)
  @Get('preferences')
  getPreferences(@CurrentUser() user: AuthUser) {
    return this.preferences.getPreferences(user.id);
  }

  /**
   * Update the logged-in user's notification preferences (M5.11).
   */
  @ApiBearerAuth()
  @ApiZodResponse('UserNotificationPreferences', userNotificationPreferencesSchema)
  @HttpCode(200)
  @Put('preferences')
  updatePreferences(
    @ZodBody(userNotificationPreferencesSchema.partial()) body: Partial<UserNotificationPreferences>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.preferences.updatePreferences(user.id, body);
  }

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
  @Post('devices/register')
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
  @Post('devices/unregister')
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
  @Delete('devices/:token')
  deleteDeviceToken(
    @Param('token') token: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notifications.unregisterDeviceToken(user.id, token);
  }
}

