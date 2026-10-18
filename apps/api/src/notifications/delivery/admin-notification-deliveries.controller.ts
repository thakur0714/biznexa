import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { notificationDeliveryFilterSchema, notificationDeliveryPageSchema, notificationDeliverySchema, type NotificationDeliveryFilter, PERMS } from '@biznexa/types';
import { AuthUser, CurrentUser, RequirePermissions } from '../../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../../common/openapi';
import { NotificationDeliveriesService } from './notification-deliveries.service';
import { NotificationQueueService } from './notification-queue.service';

@ApiTags('admin · notifications')
@ApiBearerAuth()
@RequirePermissions(PERMS.NOTIFICATIONS_VIEW)
@Controller('admin/notifications/deliveries')
export class AdminNotificationDeliveriesController {
  constructor(
    private readonly deliveries: NotificationDeliveriesService,
    private readonly queue: NotificationQueueService,
  ) {}

  /** Delivery log, newest first. `user` is a user id or part of a name, email or mobile. */
  @ApiZodResponse('NotificationDeliveryPage', notificationDeliveryPageSchema)
  @Get()
  list(@ZodQuery(notificationDeliveryFilterSchema) query: NotificationDeliveryFilter) {
    return this.deliveries.list(query);
  }

  /** Send a FAILED delivery again, with a full set of tries. Audit-logged. */
  @ApiZodResponse('NotificationDelivery', notificationDeliverySchema)
  @ApiResponse({ status: 404, description: 'No such delivery' })
  @ApiResponse({ status: 409, description: 'The delivery is not FAILED' })
  @HttpCode(200)
  @Post(':id/retry')
  async retry(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    await this.queue.retry(id, user.id);
    return this.deliveries.get(id);
  }
}
