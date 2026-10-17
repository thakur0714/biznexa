import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { DomainEventPayloads } from '@biznexa/types';
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
    this.queues.process<Reminder>(QUEUE, async (job) => this.remind(job.data));
  }

  async confirmed(payload: DomainEventPayloads['booking.confirmed']) {
    const booking = await this.prisma.booking.findUnique({ where: { id: payload.bookingId }, select: { id: true, code: true, status: true, startAt: true, endAt: true, meetingLink: true, customer: { select: { id: true, name: true, email: true, mobile: true } }, consultant: { select: { user: { select: { name: true } } } } } });
    if (!booking || booking.status !== 'CONFIRMED') return;
    const vars = this.variables(booking);
    await this.dispatch('consultation.booked', booking.customer, vars, `${env().PUBLIC_WEB_URL}/dashboard/consultations`);
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
    const booking = await this.prisma.booking.findUnique({ where: { id: data.bookingId }, select: { id: true, code: true, status: true, startAt: true, endAt: true, meetingLink: true, customer: { select: { id: true, name: true, email: true, mobile: true } }, consultant: { select: { user: { select: { name: true } } } } } });
    if (!booking || booking.status !== 'CONFIRMED' || booking.startAt.toISOString() !== data.expectedStartAt) return;
    await this.dispatch('consultation.reminder', booking.customer, { ...this.variables(booking), hours: data.offset }, `${env().PUBLIC_WEB_URL}/dashboard/consultations`);
  }

  private variables(b: { code: string; startAt: Date; endAt: Date; meetingLink: string | null; customer: { name: string }; consultant: { user: { name: string } } }) {
    return { customerName: b.customer.name, bookingCode: b.code, consultantName: b.consultant.user.name, startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString(), meetingLink: b.meetingLink ?? '', link: `${env().PUBLIC_WEB_URL}/dashboard/consultations` };
  }

  private async dispatch(event: 'consultation.booked' | 'consultation.reminder', recipient: { id: string; name: string; email: string | null; mobile: string | null }, variables: Record<string, unknown>, link: string) {
    const templates = await this.prisma.notificationTemplate.findMany({ where: { event, isActive: true } });
    for (const template of templates) try {
      const rendered = this.templates.render(template, variables);
      await this.dispatcher.dispatch({ userId: recipient.id, channel: template.channel, event, title: rendered.subject, body: rendered.body, payload: variables, link, recipient: { email: recipient.email ?? undefined, mobile: recipient.mobile ?? undefined } });
    } catch (error) { this.logger.error(`Booking ${event} notification failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
}
