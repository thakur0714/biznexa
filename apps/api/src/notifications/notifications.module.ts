import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.service';
import { AuditModule } from '../audit/audit.module';
import { EmailChannel } from './channels/email.channel';
import { EmailProvider, emailProviderFactory } from './providers/email.provider';
import { SmsChannel } from './channels/sms.channel';
import { SmsProvider, smsProviderFactory } from './providers/sms.provider';
import { FcmProvider, fcmProviderFactory } from './providers/fcm.provider';
import { PushChannel } from './channels/push.channel';
import { InAppChannel } from './channels/in-app.channel';
import { WhatsAppChannel } from './channels/whatsapp.channel';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { TemplateEngineService } from './template-engine.service';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { AdminNotificationTemplatesController } from './admin-notification-templates.controller';
import { AdminNotificationTemplatesService } from './admin-notification-templates.service';

import { NotificationEventsListener } from './notification-events.listener';
import { NOTIFICATION_QUEUE_OPTIONS, NotificationQueueService } from './delivery/notification-queue.service';
import { NotificationDeliveriesService } from './delivery/notification-deliveries.service';
import { AdminNotificationDeliveriesController } from './delivery/admin-notification-deliveries.controller';
import { DeliveryCallbacksService, deliveryCallbackConfigProvider } from './delivery/delivery-callbacks.service';
import { DeliveryCallbacksController } from './delivery/delivery-callbacks.controller';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [
    NotificationsController,
    AdminNotificationTemplatesController,
    AdminNotificationDeliveriesController,
    DeliveryCallbacksController,
  ],
  providers: [
    emailProviderFactory,
    smsProviderFactory,
    fcmProviderFactory,
    EmailChannel,
    SmsChannel,
    PushChannel,
    InAppChannel,
    WhatsAppChannel,
    NotificationPreferencesService,
    NotificationDispatcherService,
    TemplateEngineService,
    NotificationsService,
    NotificationEventsListener,
    AdminNotificationTemplatesService,
    // Production timing (delivery-policy.ts); tests override it with fast retries.
    { provide: NOTIFICATION_QUEUE_OPTIONS, useValue: {} },
    NotificationQueueService,
    NotificationDeliveriesService,
    deliveryCallbackConfigProvider,
    DeliveryCallbacksService,
  ],
  exports: [
    NotificationQueueService,
    EmailProvider,
    SmsProvider,
    FcmProvider,
    NotificationPreferencesService,
    NotificationDispatcherService,
    TemplateEngineService,
    NotificationsService,
    NotificationEventsListener,
    AdminNotificationTemplatesService,
    EmailChannel,
    SmsChannel,
    PushChannel,
    InAppChannel,
    WhatsAppChannel,
  ],
})
export class NotificationsModule {}
