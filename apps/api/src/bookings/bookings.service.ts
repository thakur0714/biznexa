import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  BOOKING_CHANGE_WINDOW_HOURS,
  BOOKING_HOLD_MINUTES,
  formatBookingCode,
  generateSlots,
  istDate,
  assertTransition,
  type BookingList,
  type BookingView,
  type CreateBookingInput,
} from '@biznexa/types';
import { AuditService } from '../audit/audit.service';
import { AvailabilityService } from '../consultants/availability.service';
import { PrismaService } from '../prisma/prisma.service';
import { expireStaleHolds, isOverlapViolation, lockConsultant } from './booking-holds';
import { bookingViewSelect, toBookingView } from './booking-view';
import { EventBus } from '../events/event-bus';
import { BookingConfirmationService } from './booking-confirmation.service';

/**
 * Booking holds (M8.8, D58). Creating a booking takes the consultant's row lock, frees overlapping holds that
 * ran out, checks the requested start is one of the slots `generateSlots` offers right now (busy time =
 * confirmed bookings + live holds) and inserts a PENDING_PAYMENT booking holding the slot for 10 minutes.
 * The `Booking_no_overlap` exclusion constraint backs the lock: two live bookings can never overlap.
 */
@Injectable()
export class BookingsService {
  private readonly log = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly confirmation: BookingConfirmationService,
  ) {}

  async create(customerId: string, input: CreateBookingInput, now = new Date()): Promise<BookingView> {
    const consultant = await this.prisma.consultant.findFirst({
      where: { slug: input.consultantSlug, verificationStatus: 'APPROVED' },
      select: { id: true, userId: true, feePerSession: true, consultationTypes: true },
    });
    if (!consultant) throw new NotFoundException('Consultant not found');
    if (consultant.userId === customerId) throw new BadRequestException('You can’t book a consultation with yourself.');
    if (!consultant.consultationTypes.includes(input.type)) throw new BadRequestException('This consultant doesn’t offer that type of consultation.');
    if (consultant.feePerSession < 100) throw new ConflictException('This consultant can’t be booked online. Contact us for help.');

    const startAt = new Date(input.startAt);
    const date = istDate(startAt);
    const holdExpiresAt = new Date(now.getTime() + BOOKING_HOLD_MINUTES * 60_000);

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        await lockConsultant(tx, consultant.id);

        // Clicking again on the slot you already hold returns the same booking.
        const mine = await tx.booking.findFirst({
          where: { customerId, consultantId: consultant.id, startAt, type: input.type, status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
          select: { id: true },
        });
        if (mine) return mine.id;

        const rules = await this.availability.rules(tx, consultant.id, date, date);
        const endAt = new Date(startAt.getTime() + rules.sessionMinutes * 60_000);
        await expireStaleHolds(tx, consultant.id, startAt, endAt, now);
        // One live hold per customer: picking another slot releases the previous hold.
        await tx.booking.updateMany({ where: { customerId, status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } }, data: { status: 'EXPIRED' } });

        const busy = await this.availability.busy(tx, consultant.id, date, date, now);
        const offered = generateSlots(rules, { from: date, to: date, now, busy }).some((s) => s.startAt.getTime() === startAt.getTime());
        if (!offered) throw new ConflictException('This slot is no longer available. Pick another one.');

        const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('booking_code_seq') AS n`;
        const booking = await tx.booking.create({
          data: {
            code: formatBookingCode(Number(n), now),
            customerId,
            consultantId: consultant.id,
            type: input.type,
            startAt,
            endAt,
            fee: consultant.feePerSession,
            status: 'PENDING_PAYMENT',
            holdExpiresAt,
          },
          select: { id: true, code: true },
        });
        await this.audit.log(
          {
            actorId: customerId, action: 'booking.hold', entityType: 'Booking', entityId: booking.id,
            after: { code: booking.code, consultantId: consultant.id, type: input.type, startAt: startAt.toISOString(), endAt: endAt.toISOString(), fee: consultant.feePerSession, holdExpiresAt: holdExpiresAt.toISOString() },
          },
          tx,
        );
        return booking.id;
      });
      return this.view(id);
    } catch (e) {
      // The lock makes this unreachable in normal operation; the constraint is the last line of defence.
      if (isOverlapViolation(e)) throw new ConflictException('This slot is no longer available. Pick another one.');
      throw e;
    }
  }

  async list(customerId: string): Promise<BookingList> {
    const rows = await this.prisma.booking.findMany({ where: { customerId }, orderBy: [{ startAt: 'desc' }, { id: 'asc' }], take: 100, select: bookingViewSelect });
    return { items: rows.map(toBookingView) };
  }

  /** The customer's own booking; anyone else's looks missing (404). */
  async get(customerId: string, id: string): Promise<BookingView> {
    const row = await this.prisma.booking.findFirst({ where: { id, customerId }, select: bookingViewSelect });
    if (!row) throw new NotFoundException('Booking not found');
    return toBookingView(row);
  }

  async calendar(customerId: string, id: string): Promise<string> {
    const row = await this.prisma.booking.findFirst({ where: { id, customerId, status: 'CONFIRMED' }, select: { code: true, startAt: true, endAt: true, meetingLink: true, consultant: { select: { user: { select: { name: true } } } } } });
    if (!row) throw new NotFoundException('Booking not found');
    const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//BizNexa//Consultation//EN','BEGIN:VEVENT',`UID:${id}@biznexa`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(row.startAt)}`,`DTEND:${stamp(row.endAt)}`,`SUMMARY:${escape(`BizNexa consultation ${row.code}`)}`,`DESCRIPTION:${escape(`Consultation with ${row.consultant.user.name}${row.meetingLink ? `\\nJoin: ${row.meetingLink}` : ''}`)}`, ...(row.meetingLink ? [`URL:${row.meetingLink}`] : []),'END:VEVENT','END:VCALENDAR',''].join('\r\n');
  }

  async setMeetingLink(userId: string, id: string, meetingLink: string): Promise<BookingView> {
    const row = await this.prisma.booking.findFirst({ where: { id, status: 'CONFIRMED', consultant: { userId } }, select: { id: true, meetingLink: true } });
    if (!row) throw new NotFoundException('Booking not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id }, data: { meetingLink } });
      await this.audit.log({ actorId: userId, action: 'booking.meeting_link_updated', entityType: 'Booking', entityId: id, before: { meetingLink: row.meetingLink }, after: { meetingLink } }, tx);
    });
    return this.view(id);
  }

  async cancel(customerId: string, id: string, reason?: string, now = new Date()): Promise<BookingView> {
    const row = await this.prisma.booking.findFirst({ where: { id, customerId }, select: { id: true, code: true, startAt: true, endAt: true, consultantId: true } });
    if (!row) throw new NotFoundException('Booking not found');
    await this.prisma.$transaction(async (tx) => {
      // Re-checked inside the transaction: two cancels at once change the row (and write history) only once.
      const { count } = await tx.booking.updateMany({ where: { id, status: 'CONFIRMED', startAt: { gte: new Date(now.getTime() + BOOKING_CHANGE_WINDOW_HOURS * 3600_000) } }, data: { status: 'CANCELLED' } });
      if (!count) throw new ConflictException(`Bookings can be cancelled up to ${BOOKING_CHANGE_WINDOW_HOURS} hours before the session.`);
      assertTransition('booking', 'CONFIRMED', 'CANCELLED');
      await tx.bookingStatusHistory.create({ data: { bookingId: id, fromStatus: 'CONFIRMED', toStatus: 'CANCELLED', actorId: customerId, reason } });
      await this.audit.log({ actorId: customerId, action: 'booking.cancelled', entityType: 'Booking', entityId: id, before: { status: 'CONFIRMED' }, after: { status: 'CANCELLED', reason } }, tx);
    });
    await this.confirmation.replaceReminders(id, row.startAt, 'CANCELLED');
    await this.events.emit('booking.status_changed', { bookingId: id, code: row.code, from: 'CONFIRMED', to: 'CANCELLED', actorId: customerId, customerId, consultantId: row.consultantId, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(), reason });
    return this.view(id);
  }

  async reschedule(customerId: string, id: string, startAt: Date, now = new Date()): Promise<BookingView> {
    const row = await this.prisma.booking.findFirst({ where: { id, customerId }, select: { id: true, code: true, consultantId: true } });
    if (!row) throw new NotFoundException('Booking not found');
    const tooLate = `Bookings can be rescheduled up to ${BOOKING_CHANGE_WINDOW_HOURS} hours before the session.`;
    const taken = 'That slot is no longer available. Pick another time.';
    let moved: { endAt: Date };
    try {
      moved = await this.prisma.$transaction(async (tx) => {
        // Same lock as creating a hold and confirming a payment, so the new slot cannot be taken in between.
        await lockConsultant(tx, row.consultantId);
        const current = await tx.booking.findUniqueOrThrow({ where: { id }, select: { status: true, startAt: true, endAt: true } });
        if (current.status !== 'CONFIRMED' || current.startAt.getTime() - now.getTime() < BOOKING_CHANGE_WINDOW_HOURS * 3600_000 || startAt.getTime() <= now.getTime()) throw new ConflictException(tooLate);
        const date = istDate(startAt);
        const rules = await this.availability.rules(tx, row.consultantId, date, date);
        const endAt = new Date(startAt.getTime() + rules.sessionMinutes * 60_000);
        await expireStaleHolds(tx, row.consultantId, startAt, endAt, now);
        const busy = (await this.availability.busy(tx, row.consultantId, date, date, now)).filter((b) => !(b.startAt.getTime() === current.startAt.getTime() && b.endAt.getTime() === current.endAt.getTime()));
        if (!generateSlots(rules, { from: date, to: date, now, busy }).some((s) => s.startAt.getTime() === startAt.getTime())) throw new ConflictException(taken);
        assertTransition('booking', 'CONFIRMED', 'RESCHEDULED');
        assertTransition('booking', 'RESCHEDULED', 'CONFIRMED');
        await tx.booking.update({ where: { id }, data: { status: 'CONFIRMED', startAt, endAt } });
        await tx.bookingStatusHistory.create({ data: { bookingId: id, fromStatus: 'CONFIRMED', toStatus: 'RESCHEDULED', actorId: customerId, metadata: { fromStartAt: current.startAt.toISOString(), toStartAt: startAt.toISOString() } } });
        await tx.bookingStatusHistory.create({ data: { bookingId: id, fromStatus: 'RESCHEDULED', toStatus: 'CONFIRMED', actorId: customerId, metadata: { startAt: startAt.toISOString(), endAt: endAt.toISOString() } } });
        await this.audit.log({ actorId: customerId, action: 'booking.rescheduled', entityType: 'Booking', entityId: id, before: { status: 'CONFIRMED', startAt: current.startAt.toISOString(), endAt: current.endAt.toISOString() }, after: { status: 'CONFIRMED', startAt: startAt.toISOString(), endAt: endAt.toISOString() } }, tx);
        return { endAt };
      });
    } catch (e) {
      if (isOverlapViolation(e)) throw new ConflictException(taken);
      throw e;
    }
    await this.confirmation.replaceReminders(id, startAt, 'CONFIRMED');
    await this.events.emit('booking.status_changed', { bookingId: id, code: row.code, from: 'CONFIRMED', to: 'RESCHEDULED', actorId: customerId, customerId, consultantId: row.consultantId, startAt: startAt.toISOString(), endAt: moved.endAt.toISOString() });
    return this.view(id);
  }

  async consultantOutcome(userId: string, id: string, status: 'COMPLETED' | 'NO_SHOW', now = new Date()): Promise<BookingView> {
    const row = await this.prisma.booking.findFirst({ where: { id, consultant: { userId } }, select: { id: true, code: true, startAt: true, endAt: true, customerId: true, consultantId: true } });
    if (!row) throw new NotFoundException('Booking not found');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.booking.updateMany({ where: { id, status: 'CONFIRMED', endAt: { lte: now } }, data: { status } });
      if (!count) throw new ConflictException('The session must have ended before recording its outcome.');
      assertTransition('booking', 'CONFIRMED', status);
      await tx.bookingStatusHistory.create({ data: { bookingId: id, fromStatus: 'CONFIRMED', toStatus: status, actorId: userId } });
      await this.audit.log({ actorId: userId, action: `booking.${status.toLowerCase()}`, entityType: 'Booking', entityId: id, before: { status: 'CONFIRMED' }, after: { status } }, tx);
    });
    await this.confirmation.replaceReminders(id, row.startAt, status);
    await this.events.emit('booking.status_changed', { bookingId: id, code: row.code, from: 'CONFIRMED', to: status, actorId: userId, customerId: row.customerId, consultantId: row.consultantId, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString() });
    return this.view(id);
  }

  private async view(id: string): Promise<BookingView> {
    return toBookingView(await this.prisma.booking.findUniqueOrThrow({ where: { id }, select: bookingViewSelect }));
  }

  /**
   * Tidies holds that ran out. Not needed for correctness — slots already treat them as free and booking
   * frees them under the lock — but keeps statuses honest. A webhook confirming the same row wins: the
   * update re-checks the status after waiting for its row lock.
   */
  @Cron('* * * * *')
  async expireHolds(now = new Date()): Promise<number> {
    const { count } = await this.prisma.booking.updateMany({ where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
    if (count) this.log.log(`Expired ${count} booking hold${count === 1 ? '' : 's'}`);
    return count;
  }
}
