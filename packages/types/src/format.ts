/** Indian formatting helpers: ₹1,25,000 and DD-MMM-YYYY in IST. */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

/** Format paise as rupees. Whole rupees by default; pass exact=true to show paise. */
export function formatINR(paise: number, exact = false): string {
  return exact ? inrPaise.format(paise / 100) : inr.format(Math.round(paise / 100));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** DD-MMM-YYYY in Asia/Kolkata, e.g. 09-Oct-2026 */
export function formatDate(value: Date | string): string {
  const d = new Date(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}-${MONTHS[Number(get('month')) - 1]}-${get('year')}`;
}

/** DD-MMM-YYYY, HH:mm:ss in Asia/Kolkata, e.g. 09-Oct-2026, 14:05:09 — for logs where the time matters. */
export function formatDateTime(value: Date | string): string {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value));
  return `${formatDate(value)}, ${time}`;
}

/** The calendar day (YYYY-MM-DD) in Asia/Kolkata of an instant, e.g. for a date input. */
export function istDay(value: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

/** Indian financial year label for a date in IST, e.g. 2026-27 (1 April to 31 March). */
export function financialYear(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', month: 'numeric', year: 'numeric' }).formatToParts(value);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = get('month') >= 4 ? get('year') : get('year') - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** MMM-YYYY from YYYY-MM string, e.g. Oct-2026 */
export function formatMonth(value: string): string {
  const [year, month] = value.split('-');
  return `${MONTHS[Number(month) - 1]}-${year}`;
}
