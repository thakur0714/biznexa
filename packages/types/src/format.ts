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

/** Indian financial year label for a date in IST, e.g. 2026-27 (1 April to 31 March). */
export function financialYear(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', month: 'numeric', year: 'numeric' }).formatToParts(value);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = get('month') >= 4 ? get('year') : get('year') - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
