import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  availabilityExceptionInputSchema,
  consultantAvailabilitySchema,
  daysBetween,
  generateSlots,
  istDate,
  istInstant,
  MAX_SLOT_RANGE_DAYS,
  publicConsultantSlotsSchema,
  type AvailabilityRules,
  type AvailabilityUpdateInput,
  type BusyInterval,
  type ConsultantAvailability,
  type PublicConsultantSlots,
  type PublicSlotsQuery,
} from '@biznexa/types';
import type { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type ExceptionInput = z.output<typeof availabilityExceptionInputSchema>;

/** A Prisma `@db.Date` value is UTC midnight of the stored date; that date is the IST date. */
const dateString = (d: Date) => d.toISOString().slice(0, 10);
const dateValue = (date: string) => new Date(`${date}T00:00:00Z`);

/**
 * Availability (M8.6, D57): the signed-in consultant edits their own weekly windows, date exceptions and
 * slot settings; anyone can read the bookable slots of an approved consultant. Slots come from
 * `generateSlots` (packages/types) with confirmed bookings and unexpired holds as busy time.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** The caller's consultant profile; only an approved consultant manages availability. */
  private async own(userId: string) {
    const consultant = await this.prisma.consultant.findUnique({ where: { userId }, select: { id: true, verificationStatus: true } });
    if (!consultant || consultant.verificationStatus !== 'APPROVED') throw new ForbiddenException('Only an approved consultant can manage availability');
    return consultant.id;
  }

  async get(userId: string, now = new Date()): Promise<ConsultantAvailability> {
    return this.read(await this.own(userId), now);
  }

  private async read(consultantId: string, now: Date): Promise<ConsultantAvailability> {
    const consultant = await this.prisma.consultant.findUniqueOrThrow({
      where: { id: consultantId },
      select: {
        sessionMinutes: true, bufferMinutes: true, minNoticeMinutes: true,
        availability: {
          where: { OR: [{ weekday: { not: null } }, { date: { gte: dateValue(istDate(now)) } }] },
          orderBy: [{ weekday: 'asc' }, { date: 'asc' }, { startTime: 'asc' }],
          select: { id: true, weekday: true, date: true, startTime: true, endTime: true, isBlocked: true },
        },
      },
    });
    const { availability, ...settings } = consultant;
    return consultantAvailabilitySchema.parse({
      ...settings,
      weekly: availability.filter((s) => s.weekday !== null).map((s) => ({ id: s.id, weekday: s.weekday, startTime: s.startTime, endTime: s.endTime })),
      exceptions: availability.filter((s) => s.date !== null).map((s) => ({ id: s.id, date: dateString(s.date!), startTime: s.startTime, endTime: s.endTime, isBlocked: s.isBlocked })),
    });
  }

  /** Saves the settings and replaces the weekly windows, in one transaction. Exceptions are kept. */
  async update(userId: string, input: AvailabilityUpdateInput, now = new Date()): Promise<ConsultantAvailability> {
    const consultantId = await this.own(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Consultant" WHERE id = ${consultantId} FOR UPDATE`;
      const before = await tx.consultant.findUniqueOrThrow({
        where: { id: consultantId },
        select: {
          sessionMinutes: true, bufferMinutes: true, minNoticeMinutes: true,
          availability: { where: { weekday: { not: null } }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }], select: { weekday: true, startTime: true, endTime: true } },
        },
      });
      await tx.consultant.update({
        where: { id: consultantId },
        data: { sessionMinutes: input.sessionMinutes, bufferMinutes: input.bufferMinutes, minNoticeMinutes: input.minNoticeMinutes },
      });
      await tx.availabilitySlot.deleteMany({ where: { consultantId, weekday: { not: null } } });
      await tx.availabilitySlot.createMany({ data: input.weekly.map((w) => ({ consultantId, weekday: w.weekday, startTime: w.startTime, endTime: w.endTime })) });
      const weekly = [...input.weekly].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
      await this.audit.log(
        {
          actorId: userId, action: 'consultant.availability.update', entityType: 'Consultant', entityId: consultantId,
          before: { sessionMinutes: before.sessionMinutes, bufferMinutes: before.bufferMinutes, minNoticeMinutes: before.minNoticeMinutes, weekly: before.availability },
          after: { sessionMinutes: input.sessionMinutes, bufferMinutes: input.bufferMinutes, minNoticeMinutes: input.minNoticeMinutes, weekly },
        },
        tx,
      );
    });
    return this.read(consultantId, now);
  }

  async addException(userId: string, input: ExceptionInput, now = new Date()): Promise<ConsultantAvailability> {
    const consultantId = await this.own(userId);
    if (input.date < istDate(now)) throw new BadRequestException('Pick today or a later date');
    await this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.availabilitySlot.findFirst({
        where: { consultantId, date: dateValue(input.date), startTime: input.startTime, endTime: input.endTime, isBlocked: input.isBlocked },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException('This exception is already saved');
      const created = await tx.availabilitySlot.create({
        data: { consultantId, date: dateValue(input.date), startTime: input.startTime, endTime: input.endTime, isBlocked: input.isBlocked },
        select: { id: true },
      });
      await this.audit.log({ actorId: userId, action: 'consultant.availability_exception.create', entityType: 'AvailabilitySlot', entityId: created.id, after: { consultantId, ...input } }, tx);
    });
    return this.read(consultantId, now);
  }

  async removeException(userId: string, id: string, now = new Date()): Promise<ConsultantAvailability> {
    const consultantId = await this.own(userId);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.availabilitySlot.findFirst({ where: { id, consultantId, date: { not: null } }, select: { id: true, date: true, startTime: true, endTime: true, isBlocked: true } });
      if (!row) throw new NotFoundException('Exception not found');
      await tx.availabilitySlot.delete({ where: { id } });
      await this.audit.log(
        { actorId: userId, action: 'consultant.availability_exception.delete', entityType: 'AvailabilitySlot', entityId: id, before: { consultantId, date: dateString(row.date!), startTime: row.startTime, endTime: row.endTime, isBlocked: row.isBlocked } },
        tx,
      );
    });
    return this.read(consultantId, now);
  }

  /** The rules `generateSlots` needs, for exceptions on `from`..`to`. */
  async rules(db: Prisma.TransactionClient, consultantId: string, from: string, to: string): Promise<AvailabilityRules> {
    const c = await db.consultant.findUniqueOrThrow({
      where: { id: consultantId },
      select: {
        sessionMinutes: true, bufferMinutes: true, minNoticeMinutes: true,
        availability: {
          where: { OR: [{ weekday: { not: null } }, { date: { gte: dateValue(from), lte: dateValue(to) } }] },
          select: { weekday: true, date: true, startTime: true, endTime: true, isBlocked: true },
        },
      },
    });
    return {
      sessionMinutes: c.sessionMinutes,
      bufferMinutes: c.bufferMinutes,
      minNoticeMinutes: c.minNoticeMinutes,
      weekly: c.availability.filter((s) => s.weekday !== null).map((s) => ({ weekday: s.weekday!, startTime: s.startTime, endTime: s.endTime })),
      exceptions: c.availability.filter((s) => s.date !== null).map((s) => ({ date: dateString(s.date!), startTime: s.startTime, endTime: s.endTime, isBlocked: s.isBlocked })),
    };
  }

  /** Bookings that take time from `from` to `to` (IST dates): confirmed ones. */
  async busy(db: Prisma.TransactionClient, consultantId: string, from: string, to: string, _now: Date): Promise<BusyInterval[]> {
    // A day of margin either side so a booking just outside the range still keeps its buffer.
    return db.booking.findMany({
      where: {
        consultantId,
        startAt: { lt: istInstant(addDays(to, 2), 0) },
        endAt: { gt: istInstant(addDays(from, -1), 0) },
        status: 'CONFIRMED',
      },
      select: { startAt: true, endAt: true },
    });
  }

  async publicSlots(slug: string, query: PublicSlotsQuery, now = new Date()): Promise<PublicConsultantSlots> {
    const consultant = await this.prisma.consultant.findFirst({
      where: { slug, verificationStatus: 'APPROVED' },
      select: { id: true, slug: true, category: true, qualification: true, feePerSession: true, sessionMinutes: true, consultationTypes: true, user: { select: { name: true } } },
    });
    if (!consultant) throw new NotFoundException('Consultant not found');
    const from = query.from ?? istDate(now);
    const to = query.to ?? addDays(from, 6);
    const span = daysBetween(from, to);
    if (span < 0 || span >= MAX_SLOT_RANGE_DAYS) throw new BadRequestException(`Ask for 1 to ${MAX_SLOT_RANGE_DAYS} days at a time`);

    const [rules, busy] = await Promise.all([this.rules(this.prisma, consultant.id, from, to), this.busy(this.prisma, consultant.id, from, to, now)]);
    const slots = generateSlots(rules, { from, to, now, busy });
    const { user, id: _id, ...profile } = consultant;
    return publicConsultantSlotsSchema.parse({
      consultant: { ...profile, name: user.name },
      timezone: 'Asia/Kolkata',
      from,
      to,
      slots: slots.map((s) => ({ startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(), date: s.date, time: s.time })),
    });
  }
}
