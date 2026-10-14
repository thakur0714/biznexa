import type {
  NotificationChannel as NotificationChannelType,
  SendNotificationInput,
  NotificationResult,
} from '@biznexa/types';

export interface NotificationChannel {
  readonly channel: NotificationChannelType;
  send(input: SendNotificationInput): Promise<NotificationResult>;
}
