// weekday: 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
// n: 1-indexed (1=first, 2=second, ...)
// Returns a Date at UTC midnight of the Nth weekday in the given UTC year/month
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const firstDow = first.getUTCDay();
  const daysToFirst = (weekday - firstDow + 7) % 7;
  const dayOfMonth = 1 + daysToFirst + (n - 1) * 7;
  return new Date(Date.UTC(year, month, dayOfMonth));
}
