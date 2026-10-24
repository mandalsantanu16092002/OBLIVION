/** Calendar-date helpers. All dates are ISO strings YYYY-MM-DD interpreted as IST calendar dates. */

export function parseIso(d: string): { y: number; m: number; day: number } {
  const [y, m, day] = d.split('-').map(Number);
  return { y, m, day };
}

function toUtcDays(d: string): number {
  const { y, m, day } = parseIso(d);
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
}

/** Number of days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return toUtcDays(b) - toUtcDays(a);
}

/** Completed years on the given date. */
export function ageOn(dob: string, onDate: string): number {
  const b = parseIso(dob);
  const o = parseIso(onDate);
  let age = o.y - b.y;
  if (o.m < b.m || (o.m === b.m && o.day < b.day)) age -= 1;
  return age;
}

/** Add whole years; 29 February moves to 28 February when the target year is not a leap year. */
export function addYears(d: string, years: number): string {
  const { y, m, day } = parseIso(d);
  const ty = y + years;
  let td = day;
  if (m === 2 && day === 29 && !isLeap(ty)) td = 28;
  return `${String(ty).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, day } = parseIso(s);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
}

/** Today's calendar date in IST (Asia/Kolkata). */
export function todayIst(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  return ist.toISOString().slice(0, 10);
}
