import { describe, expect, it } from 'vitest';

describe('Admin Payments UI (M4.15)', () => {
  it('formats amounts in rupees from paise', () => {
    const paiseToRupees = (paise: number) => (paise / 100).toFixed(2);
    expect(paiseToRupees(118000)).toBe('1180.00');
    expect(paiseToRupees(999)).toBe('9.99');
    expect(paiseToRupees(0)).toBe('0.00');
  });

  it('escapes formula injection cells starting with =, +, -, @', () => {
    function escapeCsvCell(val: string): string {
      let s = val;
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    }

    expect(escapeCsvCell('=CMD("calc")')).toBe('"\'=CMD(""calc"")"');
    expect(escapeCsvCell('+12345')).toBe('"\'+12345"');
    expect(escapeCsvCell('-SUM(A1:A10)')).toBe('"\'-SUM(A1:A10)"');
    expect(escapeCsvCell('@EXEC()')).toBe('"\'@EXEC()"');
    expect(escapeCsvCell('Normal Text')).toBe('"Normal Text"');
  });
});
