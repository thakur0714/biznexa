/**
 * Consultant availability (M8.6, D57). A consultant keeps a **weekly schedule** (windows per weekday) and
 * **date exceptions** (blocked hours, or extra one-off hours, on one date). `generateSlots` turns them into
 * the bookable slots for a date range. Everything is in IST (UTC+05:30, no DST), so a time of day maps to an
 * instant by plain arithmetic: `HH:MM` on IST date D is `D 00:00 UTC + HH:MM − 05:30`.
 */
import { z } from 'zod';
import { consultationTypeSchema } from './consultants';

export const IST_OFFSET_MINUTES = 330;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** How long a booking holds its slot while the customer pays (M8.8). */
export const BOOKING_HOLD_MINUTES = 10;
/** Longest range the public slots endpoint answers for, in days (inclusive of both ends). */
export const MAX_SLOT_RANGE_DAYS = 14;

// ── Times and IST dates ──

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "HH:MM" → minutes after midnight. "24:00" (end of day) is 1440. */
export function timeToMinutes(time: string): number {
  if (!TIME.test(time)) throw new Error(`Invalid time ${time}`);
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The IST calendar date of an instant, YYYY-MM-DD. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MINUTES * MINUTE).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for an IST date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
}

/** Days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY);
}

/** The instant of `minutes` after IST midnight on `date` (1440 is the next IST midnight). */
export function istInstant(date: string, minutes: number): Date {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + (minutes - IST_OFFSET_MINUTES) * MINUTE);
}

// ── Slot generation ──

export interface WeeklyWindow {
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface DateException {
  /** IST date, YYYY-MM-DD. */
  date: string;
  startTime: string;
  endTime: string;
  /** true: no slots in these hours that day. false: extra hours that day, on top of the weekly schedule. */
  isBlocked: boolean;
}

export interface AvailabilityRules {
  weekly: WeeklyWindow[];
  exceptions: DateException[];
  sessionMinutes: number;
  /** Free time after each session before the next one can start. */
  bufferMinutes: number;
  /** Slots starting sooner than this after `now` are not offered. */
  minNoticeMinutes: number;
}

export interface BusyInterval {
  startAt: Date;
  endAt: Date;
}

export interface GeneratedSlot {
  startAt: Date;
  endAt: Date;
  /** IST date and start time, for display and grouping. */
  date: string;
  time: string;
}

type Range = [number, number];

/** Sorted, overlapping or touching ranges joined. */
function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

/**
 * The bookable slots from IST date `from` to `to` (both included), sorted by start.
 *
 * Per date: the weekday's windows plus that date's extra hours are merged, then slots are laid from each
 * window's start every `sessionMinutes + bufferMinutes`; a session that would run past the window's end is
 * not offered. A slot is dropped when it overlaps that date's blocked hours (blocked beats weekly and extra
 * hours), starts before `now + minNoticeMinutes`, or comes within `bufferMinutes` of a busy interval
 * (a confirmed booking or an unexpired hold).
 */
export function generateSlots(
  rules: AvailabilityRules,
  range: { from: string; to: string; now: Date; busy?: BusyInterval[] },
): GeneratedSlot[] {
  const { sessionMinutes, bufferMinutes } = rules;
  if (!Number.isInteger(sessionMinutes) || sessionMinutes <= 0) throw new Error('sessionMinutes must be a positive whole number');
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0) throw new Error('bufferMinutes must be a whole number ≥ 0');
  const earliest = range.now.getTime() + rules.minNoticeMinutes * MINUTE;
  const pad = bufferMinutes * MINUTE;
  const busy = (range.busy ?? []).map((b) => [b.startAt.getTime() - pad, b.endAt.getTime() + pad] as Range);
  const step = sessionMinutes + bufferMinutes;
  const slots: GeneratedSlot[] = [];

  for (let date = range.from; daysBetween(date, range.to) >= 0; date = addDays(date, 1)) {
    for (const slot of slotsForDate(date, rules, sessionMinutes, earliest, busy, step)) slots.push(slot);
  }
  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

function slotsForDate(date: string, rules: AvailabilityRules, sessionMinutes: number, earliest: number, busy: Range[], step: number): GeneratedSlot[] {
  const weekday = weekdayOf(date);
  const toRange = (w: { startTime: string; endTime: string }): Range => [timeToMinutes(w.startTime), timeToMinutes(w.endTime)];
  const sameDay = rules.exceptions.filter((e) => e.date === date);
  const windows = merge([
    ...rules.weekly.filter((w) => w.weekday === weekday).map(toRange),
    ...sameDay.filter((e) => !e.isBlocked).map(toRange),
  ]);
  const blocked = sameDay.filter((e) => e.isBlocked).map(toRange);
  const slots: GeneratedSlot[] = [];

  for (const [winStart, winEnd] of windows) {
    for (let start = winStart; start + sessionMinutes <= winEnd; start += step) {
      const end = start + sessionMinutes;
      if (blocked.some(([bs, be]) => overlaps(start, end, bs, be))) continue;
      const startAt = istInstant(date, start);
      const endAt = istInstant(date, end);
      if (startAt.getTime() < earliest) continue;
      if (busy.some(([bs, be]) => overlaps(startAt.getTime(), endAt.getTime(), bs, be))) continue;
      slots.push({ startAt, endAt, date, time: minutesToTime(start) });
    }
  }
  return slots;
}

// ── API schemas ──

export const timeOfDaySchema = z.string().regex(TIME, 'Use a time like 09:30');
export const isoDateSchema = z.string().refine(isIsoDate, 'Use a date like 2026-10-20');

const windowShape = {
  startTime: timeOfDaySchema.refine((t) => t !== '24:00', 'A window can’t start at 24:00'),
  endTime: timeOfDaySchema,
};
/** Minutes, or NaN for a malformed time (its own field already reports that). */
const safeMinutes = (time: string | undefined) => (time !== undefined && TIME.test(time) ? timeToMinutes(time) : Number.NaN);
const endAfterStart = (w: { startTime: string; endTime: string }) => !(safeMinutes(w.endTime) <= safeMinutes(w.startTime));
const END_AFTER_START = { message: 'End time must be after the start time', path: ['endTime'] };

export const weeklyWindowSchema = z
  .object({ weekday: z.number().int().min(0).max(6), ...windowShape })
  .strict()
  .refine(endAfterStart, END_AFTER_START);

/** The consultant's whole schedule, saved at once (replaces the weekly windows). */
export const availabilityUpdateInputSchema = z
  .object({
    sessionMinutes: z.number().int().min(15).max(240).refine((n) => n % 5 === 0, 'Use a multiple of 5 minutes'),
    bufferMinutes: z.number().int().min(0).max(120),
    minNoticeMinutes: z.number().int().min(0).max(14 * 24 * 60),
    weekly: z.array(weeklyWindowSchema).max(70),
  })
  .strict()
  .superRefine((input, ctx) => {
    for (let day = 0; day < 7; day++) {
      const ranges = input.weekly
        .map((w, i) => ({ i, s: safeMinutes(w.startTime), e: safeMinutes(w.endTime), day: w.weekday }))
        .filter((w) => w.day === day)
        .sort((a, b) => a.s - b.s);
      for (let k = 1; k < ranges.length; k++) {
        if (ranges[k].s < ranges[k - 1].e) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weekly', ranges[k].i, 'startTime'], message: 'Windows on the same day can’t overlap' });
        }
      }
    }
  });
export type AvailabilityUpdateInput = z.infer<typeof availabilityUpdateInputSchema>;

/** A blocked period or extra hours on one date. Blocked with no times = the whole day. */
export const availabilityExceptionInputSchema = z
  .object({
    date: isoDateSchema,
    isBlocked: z.boolean(),
    startTime: windowShape.startTime.optional(),
    endTime: windowShape.endTime.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasStart = input.startTime !== undefined;
    const hasEnd = input.endTime !== undefined;
    if (hasStart !== hasEnd) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [hasStart ? 'endTime' : 'startTime'], message: 'Give both a start and an end time' });
    else if (!hasStart && !input.isBlocked) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startTime'], message: 'Extra hours need a start and an end time' });
    else if (hasStart && safeMinutes(input.endTime) <= safeMinutes(input.startTime)) ctx.addIssue({ code: z.ZodIssueCode.custom, ...END_AFTER_START });
  })
  .transform((input) => ({ date: input.date, isBlocked: input.isBlocked, startTime: input.startTime ?? '00:00', endTime: input.endTime ?? '24:00' }));
export type AvailabilityExceptionInput = z.input<typeof availabilityExceptionInputSchema>;

export const availabilityExceptionSchema = z.object({
  id: z.string().uuid(),
  date: isoDateSchema,
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  isBlocked: z.boolean(),
});
export type AvailabilityException = z.infer<typeof availabilityExceptionSchema>;

export const consultantAvailabilitySchema = z.object({
  sessionMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  minNoticeMinutes: z.number().int(),
  weekly: z.array(z.object({ id: z.string().uuid(), weekday: z.number().int(), startTime: timeOfDaySchema, endTime: timeOfDaySchema })),
  /** Exceptions from today (IST) on. */
  exceptions: z.array(availabilityExceptionSchema),
});
export type ConsultantAvailability = z.infer<typeof consultantAvailabilitySchema>;

/** `from` defaults to today (IST), `to` to six days after `from`; at most 14 days, not in the past. */
export const publicSlotsQuerySchema = z
  .object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() })
  .superRefine((q, ctx) => {
    if (q.from && q.to) {
      const span = daysBetween(q.from, q.to);
      if (span < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: '`to` must not be before `from`' });
      else if (span >= MAX_SLOT_RANGE_DAYS) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: `At most ${MAX_SLOT_RANGE_DAYS} days at a time` });
    }
  });
export type PublicSlotsQuery = z.infer<typeof publicSlotsQuerySchema>;

export const publicSlotSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  date: isoDateSchema,
  time: timeOfDaySchema,
});

export const publicConsultantSlotsSchema = z.object({
  consultant: z.object({
    slug: z.string(),
    name: z.string(),
    category: z.string(),
    qualification: z.string(),
    feePerSession: z.number().int(),
    sessionMinutes: z.number().int(),
    consultationTypes: z.array(consultationTypeSchema),
  }),
  timezone: z.literal('Asia/Kolkata'),
  from: isoDateSchema,
  to: isoDateSchema,
  slots: z.array(publicSlotSchema),
});
export type PublicConsultantSlots = z.infer<typeof publicConsultantSlotsSchema>;
