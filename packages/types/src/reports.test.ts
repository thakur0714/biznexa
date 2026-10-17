import { describe, expect, it } from 'vitest';
import {
  getDaysInISTRange,
  isWithinISTDay,
  istDayEnd,
  istDayStart,
  normalizeReportPreset,
  presetDateRange,
  resolveReportDateRange,
} from './reports';

describe('Reports Date & IST Boundary Helpers', () => {
  it('normalizes presets with spaces and underscores', () => {
    expect(normalizeReportPreset('today')).toBe('today');
    expect(normalizeReportPreset('TODAY')).toBe('today');
    expect(normalizeReportPreset('last 7 days')).toBe('last 7 days');
    expect(normalizeReportPreset('last_7_days')).toBe('last 7 days');
    expect(normalizeReportPreset('this month')).toBe('this month');
    expect(normalizeReportPreset('this_month')).toBe('this month');
    expect(normalizeReportPreset('last month')).toBe('last month');
    expect(normalizeReportPreset('last_month')).toBe('last month');
    expect(normalizeReportPreset('invalid')).toBeNull();
    expect(normalizeReportPreset(null)).toBeNull();
  });

  it('istDayStart returns 00:00:00.000 in IST (+05:30) which is 18:30:00.000Z previous day', () => {
    const start = istDayStart('2026-10-17');
    expect(start.toISOString()).toBe('2026-10-16T18:30:00.000Z');
  });

  it('istDayEnd returns 23:59:59.999 in IST (+05:30) which is 18:29:59.999Z same day', () => {
    const end = istDayEnd('2026-10-17');
    expect(end.toISOString()).toBe('2026-10-17T18:29:59.999Z');
  });

  it('handles boundary cases: payment at 23:59 IST vs 00:01 IST next day', () => {
    const start17 = istDayStart('2026-10-17'); // 2026-10-16T18:30:00.000Z
    const end17 = istDayEnd('2026-10-17');     // 2026-10-17T18:29:59.999Z

    // Payment at 23:59 IST on 17-Oct-2026 = 18:29:00 UTC
    const payment2359 = new Date('2026-10-17T23:59:00.000+05:30');
    expect(payment2359.toISOString()).toBe('2026-10-17T18:29:00.000Z');
    expect(payment2359.getTime()).toBeGreaterThanOrEqual(start17.getTime());
    expect(payment2359.getTime()).toBeLessThanOrEqual(end17.getTime());
    expect(isWithinISTDay(payment2359, '2026-10-17')).toBe(true);
    expect(isWithinISTDay(payment2359, '2026-10-18')).toBe(false);

    // Payment at 00:01 IST on 18-Oct-2026 = 18:31:00 UTC on 17-Oct-2026
    const payment0001 = new Date('2026-10-18T00:01:00.000+05:30');
    expect(payment0001.toISOString()).toBe('2026-10-17T18:31:00.000Z');
    expect(payment0001.getTime()).toBeGreaterThan(end17.getTime());
    expect(isWithinISTDay(payment0001, '2026-10-17')).toBe(false);
    expect(isWithinISTDay(payment0001, '2026-10-18')).toBe(true);

    // Payment at 23:59 IST on 16-Oct-2026 = 18:29:00 UTC on 16-Oct-2026
    const paymentPrev2359 = new Date('2026-10-16T23:59:00.000+05:30');
    expect(paymentPrev2359.getTime()).toBeLessThan(start17.getTime());
    expect(isWithinISTDay(paymentPrev2359, '2026-10-17')).toBe(false);
  });

  describe('Presets calculation', () => {
    // Reference instant: 2026-10-17 14:00:00 IST
    const fixedNow = new Date('2026-10-17T14:00:00.000+05:30');

    it('today preset', () => {
      const range = presetDateRange('today', fixedNow);
      expect(range.from.toISOString()).toBe('2026-10-16T18:30:00.000Z');
      expect(range.to.toISOString()).toBe('2026-10-17T18:29:59.999Z');
    });

    it('last 7 days preset spans 7 consecutive IST days', () => {
      const range = presetDateRange('last 7 days', fixedNow);
      expect(range.from.toISOString()).toBe('2026-10-10T18:30:00.000Z'); // 2026-10-11 00:00 IST
      expect(range.to.toISOString()).toBe('2026-10-17T18:29:59.999Z');   // 2026-10-17 23:59 IST
      const days = getDaysInISTRange(range.from, range.to);
      expect(days).toEqual([
        '2026-10-11',
        '2026-10-12',
        '2026-10-13',
        '2026-10-14',
        '2026-10-15',
        '2026-10-16',
        '2026-10-17',
      ]);
      expect(days).toHaveLength(7);
    });

    it('this month preset starts on 1st of month', () => {
      const range = presetDateRange('this month', fixedNow);
      expect(range.from.toISOString()).toBe('2026-09-30T18:30:00.000Z'); // 2026-10-01 00:00 IST
      expect(range.to.toISOString()).toBe('2026-10-17T18:29:59.999Z');
    });

    it('last month preset covers full previous month (September 2026: 30 days)', () => {
      const range = presetDateRange('last month', fixedNow);
      expect(range.from.toISOString()).toBe('2026-08-31T18:30:00.000Z'); // 2026-09-01 00:00 IST
      expect(range.to.toISOString()).toBe('2026-09-30T18:29:59.999Z');   // 2026-09-30 23:59 IST
    });

    it('last month across year boundary (January -> previous December: 31 days)', () => {
      const janNow = new Date('2026-01-15T12:00:00.000+05:30');
      const range = presetDateRange('last month', janNow);
      expect(range.from.toISOString()).toBe('2025-11-30T18:30:00.000Z'); // 2025-12-01 00:00 IST
      expect(range.to.toISOString()).toBe('2025-12-31T18:29:59.999Z');   // 2025-12-31 23:59 IST
    });
  });

  describe('resolveReportDateRange', () => {
    const fixedNow = new Date('2026-10-17T14:00:00.000+05:30');

    it('resolves explicit from and to', () => {
      const res = resolveReportDateRange({ from: '2026-10-01', to: '2026-10-05' }, fixedNow);
      expect(res.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
      expect(res.to.toISOString()).toBe('2026-10-05T18:29:59.999Z');
    });

    it('resolves preset parameter', () => {
      const res = resolveReportDateRange({ preset: 'last_7_days' }, fixedNow);
      expect(res.preset).toBe('last 7 days');
      expect(res.from.toISOString()).toBe('2026-10-10T18:30:00.000Z');
      expect(res.to.toISOString()).toBe('2026-10-17T18:29:59.999Z');
    });

    it('defaults to last 7 days when nothing provided', () => {
      const res = resolveReportDateRange({}, fixedNow);
      expect(res.preset).toBe('last 7 days');
      expect(res.from.toISOString()).toBe('2026-10-10T18:30:00.000Z');
      expect(res.to.toISOString()).toBe('2026-10-17T18:29:59.999Z');
    });
  });
});
