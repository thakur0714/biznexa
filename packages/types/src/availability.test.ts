import { describe, expect, it } from 'vitest';
import {
  addDays,
  availabilityExceptionInputSchema,
  availabilityUpdateInputSchema,
  generateSlots,
  istDate,
  istInstant,
  publicSlotsQuerySchema,
  weekdayOf,
  type AvailabilityRules,
} from './availability';

// Tuesday 20 Oct 2026, 08:00 IST.
const NOW = new Date('2026-10-20T02:30:00Z');
const TUE = '2026-10-20';
const WED = '2026-10-21';

const rules = (over: Partial<AvailabilityRules> = {}): AvailabilityRules => ({
  weekly: [],
  exceptions: [],
  sessionMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  ...over,
});
const times = (slots: { date: string; time: string }[]) => slots.map((s) => `${s.date} ${s.time}`);

describe('IST date helpers', () => {
  it('maps instants to IST dates across UTC midnight', () => {
    expect(istDate(new Date('2026-10-19T18:29:59Z'))).toBe('2026-10-19');
    expect(istDate(new Date('2026-10-19T18:30:00Z'))).toBe('2026-10-20'); // 00:00 IST
    expect(istDate(new Date('2026-12-31T18:30:00Z'))).toBe('2027-01-01');
  });

  it('turns an IST date + time into the right instant, incl. midnight and 24:00', () => {
    expect(istInstant(TUE, 0).toISOString()).toBe('2026-10-19T18:30:00.000Z');
    expect(istInstant(TUE, 5 * 60 + 30).toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(istInstant(TUE, 1440).toISOString()).toBe(istInstant(WED, 0).toISOString());
    expect(weekdayOf(TUE)).toBe(2);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('generateSlots', () => {
  it('lays sessions through a weekly window and drops one that would cross its end', () => {
    const slots = generateSlots(rules({ weekly: [{ weekday: 2, startTime: '10:00', endTime: '11:45' }] }), { from: TUE, to: TUE, now: NOW });
    expect(times(slots)).toEqual([`${TUE} 10:00`, `${TUE} 10:30`, `${TUE} 11:00`]);
    expect(slots[0].startAt.toISOString()).toBe('2026-10-20T04:30:00.000Z');
    expect(slots[0].endAt.toISOString()).toBe('2026-10-20T05:00:00.000Z');
  });

  it('leaves the buffer after each session', () => {
    const slots = generateSlots(rules({ weekly: [{ weekday: 2, startTime: '10:00', endTime: '12:00' }], sessionMinutes: 45, bufferMinutes: 15 }), {
      from: TUE, to: TUE, now: NOW,
    });
    expect(times(slots)).toEqual([`${TUE} 10:00`, `${TUE} 11:00`]);
  });

  it('only uses windows of the matching weekday, over a range of days', () => {
    const slots = generateSlots(rules({ weekly: [{ weekday: 3, startTime: '09:00', endTime: '10:00' }] }), { from: TUE, to: addDays(TUE, 8), now: NOW });
    expect(times(slots)).toEqual([`${WED} 09:00`, `${WED} 09:30`, '2026-10-28 09:00', '2026-10-28 09:30']);
  });

  it('handles windows touching IST midnight on both sides', () => {
    const slots = generateSlots(
      rules({ weekly: [{ weekday: 2, startTime: '23:00', endTime: '24:00' }, { weekday: 3, startTime: '00:00', endTime: '01:00' }], sessionMinutes: 60 }),
      { from: TUE, to: WED, now: NOW },
    );
    expect(times(slots)).toEqual([`${TUE} 23:00`, `${WED} 00:00`]);
    // 23:00 IST Tuesday is 17:30 UTC Tuesday; 00:00 IST Wednesday is 18:30 UTC Tuesday.
    expect(slots.map((s) => s.startAt.toISOString())).toEqual(['2026-10-20T17:30:00.000Z', '2026-10-20T18:30:00.000Z']);
    expect(slots[0].endAt.toISOString()).toBe(slots[1].startAt.toISOString());
  });

  it('excludes past times and times inside the minimum notice', () => {
    const weekly = [{ weekday: 2, startTime: '07:00', endTime: '11:00' }];
    // 08:00 IST now: 07:00 and 07:30 are past, 08:00 starts exactly now.
    expect(times(generateSlots(rules({ weekly, sessionMinutes: 60 }), { from: TUE, to: TUE, now: NOW }))).toEqual([`${TUE} 08:00`, `${TUE} 09:00`, `${TUE} 10:00`]);
    expect(times(generateSlots(rules({ weekly, sessionMinutes: 60, minNoticeMinutes: 90 }), { from: TUE, to: TUE, now: NOW }))).toEqual([`${TUE} 10:00`]);
    // A whole earlier day is past.
    expect(generateSlots(rules({ weekly: [{ weekday: 1, startTime: '10:00', endTime: '12:00' }] }), { from: '2026-10-19', to: '2026-10-19', now: NOW })).toEqual([]);
  });

  it('applies the minimum notice across IST midnight', () => {
    // 23:30 IST Tuesday, 2 hours notice: Wednesday 00:00 and 01:00 are too soon, 01:30 is fine.
    const now = istInstant(TUE, 23 * 60 + 30);
    const slots = generateSlots(rules({ weekly: [{ weekday: 3, startTime: '00:00', endTime: '03:00' }], minNoticeMinutes: 120 }), { from: TUE, to: WED, now });
    expect(times(slots)).toEqual([`${WED} 01:30`, `${WED} 02:00`, `${WED} 02:30`]);
  });

  it('removes slots overlapping blocked hours, even partly; blocked beats weekly and extra hours', () => {
    const slots = generateSlots(
      rules({
        weekly: [{ weekday: 2, startTime: '10:00', endTime: '13:00' }],
        exceptions: [
          { date: TUE, startTime: '10:45', endTime: '11:15', isBlocked: true },
          { date: TUE, startTime: '15:00', endTime: '16:00', isBlocked: false },
          { date: TUE, startTime: '15:30', endTime: '24:00', isBlocked: true },
        ],
      }),
      { from: TUE, to: TUE, now: NOW },
    );
    // 10:30 and 11:00 touch the 10:45–11:15 block; 15:30 is in the evening block.
    expect(times(slots)).toEqual([`${TUE} 10:00`, `${TUE} 11:30`, `${TUE} 12:00`, `${TUE} 12:30`, `${TUE} 15:00`]);
  });

  it('a whole-day block removes the weekday’s windows on that date only', () => {
    const weekly = [{ weekday: 2, startTime: '10:00', endTime: '11:00' }];
    const slots = generateSlots(rules({ weekly, exceptions: [{ date: TUE, startTime: '00:00', endTime: '24:00', isBlocked: true }] }), {
      from: TUE, to: addDays(TUE, 7), now: NOW,
    });
    expect(times(slots)).toEqual(['2026-10-27 10:00', '2026-10-27 10:30']);
  });

  it('adds extra one-off hours, merged with an adjacent weekly window into one run of sessions', () => {
    const slots = generateSlots(
      rules({
        weekly: [{ weekday: 2, startTime: '10:00', endTime: '10:45' }],
        exceptions: [
          { date: TUE, startTime: '10:45', endTime: '11:30', isBlocked: false },
          { date: '2026-10-24', startTime: '09:00', endTime: '09:30', isBlocked: false }, // a Saturday with no weekly hours
        ],
        sessionMinutes: 45,
      }),
      { from: TUE, to: '2026-10-24', now: NOW },
    );
    expect(times(slots)).toEqual([`${TUE} 10:00`, `${TUE} 10:45`]);
    const sat = generateSlots(rules({ exceptions: [{ date: '2026-10-24', startTime: '09:00', endTime: '09:30', isBlocked: false }] }), { from: TUE, to: '2026-10-24', now: NOW });
    expect(times(sat)).toEqual(['2026-10-24 09:00']);
  });

  it('removes slots taken by bookings or holds, keeping the buffer around them', () => {
    const weekly = [{ weekday: 2, startTime: '10:00', endTime: '13:00' }];
    const busy = [{ startAt: istInstant(TUE, 11 * 60), endAt: istInstant(TUE, 11 * 60 + 45) }];
    expect(times(generateSlots(rules({ weekly, sessionMinutes: 45 }), { from: TUE, to: TUE, now: NOW, busy }))).toEqual([`${TUE} 10:00`, `${TUE} 12:15`]);
    // With a 15-minute buffer the grid is 10:00, 11:00, 12:00; the booking takes 11:00 and its buffer touches neither neighbour.
    expect(times(generateSlots(rules({ weekly, sessionMinutes: 45, bufferMinutes: 15 }), { from: TUE, to: TUE, now: NOW, busy }))).toEqual([`${TUE} 10:00`, `${TUE} 12:00`]);
    // A booking off the grid (made before the session length changed) also blocks the buffer next to it.
    const offGrid = [{ startAt: istInstant(TUE, 10 * 60 + 50), endAt: istInstant(TUE, 11 * 60 + 20) }];
    expect(times(generateSlots(rules({ weekly, sessionMinutes: 45, bufferMinutes: 15 }), { from: TUE, to: TUE, now: NOW, busy: offGrid }))).toEqual([`${TUE} 12:00`]);
  });

  it('returns slots sorted by start time across windows', () => {
    const slots = generateSlots(
      rules({ weekly: [{ weekday: 2, startTime: '14:00', endTime: '15:00' }, { weekday: 2, startTime: '09:00', endTime: '10:00' }], sessionMinutes: 60 }),
      { from: TUE, to: TUE, now: NOW },
    );
    expect(times(slots)).toEqual([`${TUE} 09:00`, `${TUE} 14:00`]);
  });
});

describe('availability schemas', () => {
  const base = { sessionMinutes: 30, bufferMinutes: 10, minNoticeMinutes: 120 };

  it('accepts a schedule and refuses overlapping windows on one day, bad times and odd session lengths', () => {
    expect(availabilityUpdateInputSchema.safeParse({ ...base, weekly: [{ weekday: 1, startTime: '09:00', endTime: '13:00' }, { weekday: 1, startTime: '13:00', endTime: '24:00' }] }).success).toBe(true);
    expect(availabilityUpdateInputSchema.safeParse({ ...base, weekly: [{ weekday: 1, startTime: '09:00', endTime: '13:00' }, { weekday: 1, startTime: '12:00', endTime: '14:00' }] }).success).toBe(false);
    expect(availabilityUpdateInputSchema.safeParse({ ...base, weekly: [{ weekday: 1, startTime: '13:00', endTime: '09:00' }] }).success).toBe(false);
    expect(availabilityUpdateInputSchema.safeParse({ ...base, weekly: [{ weekday: 7, startTime: '09:00', endTime: '10:00' }] }).success).toBe(false);
    expect(availabilityUpdateInputSchema.safeParse({ ...base, weekly: [{ weekday: 1, startTime: '9:00', endTime: '10:00' }] }).success).toBe(false);
    expect(availabilityUpdateInputSchema.safeParse({ ...base, weekly: [{ weekday: 1, startTime: '24:00', endTime: '24:00' }] }).success).toBe(false);
    expect(availabilityUpdateInputSchema.safeParse({ ...base, sessionMinutes: 32, weekly: [] }).success).toBe(false);
  });

  it('exceptions: blocked without times is the whole day; extra hours need times', () => {
    expect(availabilityExceptionInputSchema.parse({ date: TUE, isBlocked: true })).toEqual({ date: TUE, isBlocked: true, startTime: '00:00', endTime: '24:00' });
    expect(availabilityExceptionInputSchema.safeParse({ date: TUE, isBlocked: false }).success).toBe(false);
    expect(availabilityExceptionInputSchema.safeParse({ date: TUE, isBlocked: false, startTime: '10:00' }).success).toBe(false);
    expect(availabilityExceptionInputSchema.safeParse({ date: '2026-02-30', isBlocked: true }).success).toBe(false);
    expect(availabilityExceptionInputSchema.parse({ date: TUE, isBlocked: false, startTime: '18:00', endTime: '20:00' }).startTime).toBe('18:00');
  });

  it('public slots query allows at most 14 days and no inverted range', () => {
    expect(publicSlotsQuerySchema.safeParse({ from: TUE, to: addDays(TUE, 13) }).success).toBe(true);
    expect(publicSlotsQuerySchema.safeParse({ from: TUE, to: addDays(TUE, 14) }).success).toBe(false);
    expect(publicSlotsQuerySchema.safeParse({ from: WED, to: TUE }).success).toBe(false);
    expect(publicSlotsQuerySchema.safeParse({}).success).toBe(true);
  });
});
