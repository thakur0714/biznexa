import { addMonthsClamped } from './reminders.service';

describe('addMonthsClamped', () => {
  it('keeps the day when the target month has it', () => {
    expect(addMonthsClamped(new Date('2026-03-15T10:00:00Z'), 3).toISOString()).toBe('2026-06-15T10:00:00.000Z');
  });

  it('stays on the last day of a shorter month', () => {
    expect(addMonthsClamped(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonthsClamped(new Date('2028-01-31T10:00:00Z'), 1).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addMonthsClamped(new Date('2026-08-31T10:00:00Z'), 6).toISOString()).toBe('2027-02-28T10:00:00.000Z');
  });

  it('crosses the year for annual renewals', () => {
    expect(addMonthsClamped(new Date('2026-12-31T10:00:00Z'), 12).toISOString()).toBe('2027-12-31T10:00:00.000Z');
  });
});
