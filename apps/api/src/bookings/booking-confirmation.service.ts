import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { formatDate, type DomainEventPayloads } from '@biznexa/types';
import { QueueService } from '../queue/queue.service';
import { EventBus } from '../events/event-bus';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatcherService } from '../notifications/notification-dispatcher.service';
import { TemplateEngineService } from '../notifications/template-engine.service';
import { env } from '../config/env';

const QUEUE = 'booking-reminders';
type Reminder = { bookingId: string; expectedStartAt: string; offset: 24 | 1 };

@Injectable()
export class BookingConfirmationService implements OnModuleInit {
  private readonly logger = new Logger(BookingConfirmationService.name);
  constructor(private readonly queues: QueueService, private readonly events: EventBus, private readonly prisma: PrismaService, private readonly dispatcher: NotificationDispatcherService, private readonly templates: TemplateEngineService) {}

  onModuleInit() {
    this.events.on('booking.confirmed', (e) => this.confirmed(e.payload));
    this.events.on('booking.status_changed', (e) => (e.payload.to === 'CANCELLED' ? this.cancelled(e.payload.bookingId, e.payload.reason) : undefined));
    this.queues.process<Reminder>(QUEUE, async (job) => this.remind(job.data));
  }

  async confirmed(payload: DomainEventPayloads['booking.confirmed']) {
    const booking = await this.load(payload.bookingId);
    if (!booking || booking.status !== 'CONFIRMED') return;
    await this.dispatch('consultation.booked', booking.customer, this.variables(booking), `${env().PUBLIC_WEB_URL}/dashboard/consultations`);
    await this.replaceReminders(booking.id, booking.startAt, booking.status);
  }

  async replaceReminders(bookingId: string, startAt: Date, status: string) {
    const q = this.queues.queue<Reminder>(QUEUE);
    for (const offset of [24, 1] as const) {
      const id = `${bookingId}-${offset}`;
      const old = await q.getJob(id);
      if (old) await old.remove().catch(() => undefined);
      if (status !== 'CONFIRMED') continue;
      const delay = Math.max(0, startAt.getTime() - Date.now() - offset * 60 * 60_000);
      if (delay > 0) await q.add('booking-reminder', { bookingId, expectedStartAt: startAt.toISOString(), offset }, { jobId: id, delay });
    }
  }

  private async remind(data: Reminder) {
    const booking = await this.load(data.bookingId);
    if (!booking || booking.status !== 'CONFIRMED' || booking.startAt.toISOString() !== data.expectedStartAt) return;
    await this.dispatch('consultation.reminder', booking.customer, { ...this.variables(booking), minutesBefore: data.offset * 60 }, `${env().PUBLIC_WEB_URL}/dashboard/consultations`);
  }

  async cancelled(bookingId: string, reason?: string) {
    const booking = await this.load(bookingId);
    if (!booking || booking.status !== 'CANCELLED') return;
    await this.dispatch('consultation.cancelled', booking.customer, { ...this.variables(booking), reason: reason ?? 'Cancelled at your request' }, `${env().PUBLIC_WEB_URL}/dashboard/consultations`);
  }

  private load(id: string) {
    return this.prisma.booking.findUnique({ where: { id }, select: { id: true, code: true, status: true, startAt: true, endAt: true, meetingLink: true, customer: { select: { id: true, name: true, email: true, mobile: true } }, consultant: { select: { user: { select: { name: true } } } } } });
  }

  /** The names the seeded consultation.* templates use (seed-notifications.ts); a missing one stops the message. */
  private variables(b: { code: string; startAt: Date; meetingLink: string | null; customer: { name: string }; consultant: { user: { name: string } } }) {
    const time = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(b.startAt);
    return { customerName: b.customer.name, expertName: b.consultant.user.name, bookingCode: b.code, date: formatDate(b.startAt), time, meetingLink: b.meetingLink ?? '' };
  }

  private async dispatch(event: 'consultation.booked' | 'consultation.reminder' | 'consultation.cancelled', recipient: { id: string; name: string; email: string | null; mobile: string | null }, variables: Record<string, unknown>, link: string) {
    const templates = await this.prisma.notificationTemplate.findMany({ where: { event, isActive: true } });
    for (const template of templates) try {
      const rendered = this.templates.render(template, variables);
      await this.dispatcher.dispatch({ userId: recipient.id, channel: template.channel, event, title: rendered.subject, body: rendered.body, payload: variables, link, recipient: { email: recipient.email ?? undefined, mobile: recipient.mobile ?? undefined } });
    } catch (error) { this.logger.error(`Booking ${event} notification failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
}
