import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.service';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';
import { PushChannel } from './channels/push.channel';
import { InAppChannel } from './channels/in-app.channel';
import { WhatsAppChannel } from './channels/whatsapp.channel';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { TemplateEngineService } from './template-engine.service';

@Module({
  imports: [PrismaModule],
  providers: [
    EmailChannel,
    SmsChannel,
    PushChannel,
    InAppChannel,
    WhatsAppChannel,
    NotificationPreferencesService,
    NotificationDispatcherService,
    TemplateEngineService,
  ],
  exports: [
    NotificationPreferencesService,
    NotificationDispatcherService,
    TemplateEngineService,
    EmailChannel,
    SmsChannel,
    PushChannel,
    InAppChannel,
    WhatsAppChannel,
  ],
})
export class NotificationsModule {}
