/** Simulation time is measured in minutes since Day 1 00:00. */

export const MIN_PER_DAY = 1440;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function dayIndex(t: number): number {
  return Math.floor(t / MIN_PER_DAY);
}

export function minuteOfDay(t: number): number {
  return ((t % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
}

export function hourOfDay(t: number): number {
  return minuteOfDay(t) / 60;
}

export function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}

export function fmtClock(t: number, withSeconds = false): string {
  const m = minuteOfDay(t);
  const base = `${pad2(m / 60)}:${pad2(m % 60)}`;
  if (!withSeconds) return base;
  const s = (t - Math.floor(t)) * 60;
  return `${base}:${pad2(s)}`;
}

export function dayName(t: number): string {
  return DAY_NAMES[dayIndex(t) % 7];
}

export function fmtDay(t: number): string {
  return `Day ${dayIndex(t) + 1} · ${dayName(t)}`;
}

export function fmtDuration(min: number): string {
  if (min < 1) return '<1m';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${pad2(m)}m` : `${m}m`;
}

/** IOS-style syslog timestamp, e.g. "Oct 16 08:31:22". */
export function fmtSyslog(t: number): string {
  const d = dayIndex(t);
  const date = 12 + d; // the campaign starts on Mon Oct 12
  const month = date > 31 ? 'Nov' : 'Oct';
  const dd = date > 31 ? date - 31 : date;
  return `${month} ${String(dd).padStart(2, ' ')} ${fmtClock(t, true)}`;
}

export function isWeekend(t: number): boolean {
  return dayIndex(t) % 7 >= 5;
}

/**
 * Daylight factor 0 (night) .. 1 (full day) with smooth sunrise ~06:00-07:30
 * and sunset ~18:30-20:00.
 */
export function daylight(t: number): number {
  const h = hourOfDay(t);
  if (h < 6 || h > 20) return 0;
  if (h < 7.5) return (h - 6) / 1.5;
  if (h > 18.5) return 1 - (h - 18.5) / 1.5;
  return 1;
}
