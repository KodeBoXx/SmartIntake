export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Adds months while preserving the day-of-month, clamping to the target month's last day. */
export function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay));
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function compareDays(a: Date, b: Date): number {
  return startOfDay(a).getTime() - startOfDay(b).getTime();
}

export function isBeforeDay(a: Date, b: Date): boolean {
  return compareDays(a, b) < 0;
}

export function isAfterDay(a: Date, b: Date): boolean {
  return compareDays(a, b) > 0;
}

export function isWithinRange(d: Date, start: Date, end: Date): boolean {
  return !isBeforeDay(d, start) && !isAfterDay(d, end);
}

export function clampToBounds(d: Date, min: Date | null, max: Date | null): Date {
  if (min && isBeforeDay(d, min)) return startOfDay(min);
  if (max && isAfterDay(d, max)) return startOfDay(max);
  return startOfDay(d);
}

/**
 * 6×7 day grid for the given month, padded with leading/trailing days from the
 * adjacent months so every row is a full week. Always 6 rows for a stable layout.
 */
export function buildMonthMatrix(viewMonth: Date, weekStartsOn: number): Date[][] {
  const monthStart = startOfMonth(viewMonth);
  const leading = (monthStart.getDay() - weekStartsOn + 7) % 7;
  const gridStart = addDays(monthStart, -leading);

  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(addDays(gridStart, w * 7 + d));
    }
    weeks.push(week);
  }
  return weeks;
}

/** Localised short weekday labels in display order (depends on weekStartsOn). */
export function getWeekdayLabels(locale: string, weekStartsOn: number): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // Sunday Jan 4 1970 — a known Sunday far from any DST shift.
  const sunday = new Date(1970, 0, 4);
  const labels: string[] = [];
  for (let i = 0; i < 7; i++) {
    labels.push(formatter.format(addDays(sunday, (weekStartsOn + i) % 7)));
  }
  return labels;
}

export function formatMonthYear(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(d);
}

export function formatDate(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}

export function formatDateTime(d: Date, locale: string, use24Hour: boolean): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: !use24Hour,
  }).format(d);
}

export function setTime(d: Date, hours: number, minutes: number, seconds = 0): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours, minutes, seconds, 0);
}
