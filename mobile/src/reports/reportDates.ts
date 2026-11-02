export type PeriodMode = 'day' | 'month' | 'year';

export type DateRange = { from: string; to: string };

export function toDateString(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateString(value: string) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function todayRange(): DateRange {
  const today = toDateString(new Date());
  return { from: today, to: today };
}

export function monthRange(base = new Date()): DateRange {
  const from = toDateString(new Date(base.getFullYear(), base.getMonth(), 1));
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  const today = new Date();
  const toDate =
    base.getFullYear() === today.getFullYear() && base.getMonth() === today.getMonth()
      ? today
      : last;
  return { from, to: toDateString(toDate) };
}

export function yearRange(year = new Date().getFullYear()): DateRange {
  const today = new Date();
  const from = toDateString(new Date(year, 0, 1));
  const to =
    year === today.getFullYear()
      ? toDateString(today)
      : toDateString(new Date(year, 11, 31));
  return { from, to };
}

export function dayRange(date = new Date()): DateRange {
  const day = toDateString(date);
  return { from: day, to: day };
}

export function last30DaysRange(): DateRange {
  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - 29);
  return { from: toDateString(fromDate), to: toDateString(now) };
}

export function rangeForPeriod(mode: PeriodMode, anchor: Date): DateRange {
  if (mode === 'day') return dayRange(anchor);
  if (mode === 'year') return yearRange(anchor.getFullYear());
  return monthRange(anchor);
}

export function shiftAnchor(mode: PeriodMode, anchor: Date, delta: number): Date {
  const next = new Date(anchor);
  if (mode === 'day') next.setDate(next.getDate() + delta);
  else if (mode === 'month') next.setMonth(next.getMonth() + delta);
  else next.setFullYear(next.getFullYear() + delta);
  return next;
}

export function formatPeriodLabel(mode: PeriodMode, range: DateRange, anchor: Date) {
  if (mode === 'day') {
    return anchor.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  if (mode === 'month') {
    return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  return String(anchor.getFullYear());
}

export function periodSummaryLabel(mode: PeriodMode, range: DateRange) {
  if (mode === 'day') return `Day · ${range.from}`;
  if (mode === 'month') return `Month · ${range.from} to ${range.to}`;
  return `Year · ${range.from} to ${range.to}`;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
