export function currentMonthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function todayISO(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Resolves a "day of month" (1-31) to a real date in the given month/year,
 * clamping to the last day when the month is shorter (e.g. 31 in February). */
export function resolveDueDate(dayOfMonth: number, year: number, monthIndex: number): Date {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  return new Date(year, monthIndex, Math.min(dayOfMonth, lastDay))
}

/** Parses a 'yyyy-MM-dd' string as a local date (avoids the UTC-midnight
 * shift that plain `new Date(isoString)` causes in negative-offset zones). */
export function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** Returns the Monday of the Monday-start calendar week containing the given
 * date (time-of-day stripped). */
export function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = result.getDay() // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const daysSinceMonday = (day + 6) % 7
  result.setDate(result.getDate() - daysSinceMonday)
  return result
}

/** Returns the ISO 'yyyy-MM-dd' of the Monday of the week containing `date` —
 * a sortable week-bucket key, mirroring how currentMonthKey buckets months. */
export function currentWeekKey(date: Date = new Date()): string {
  return todayISO(startOfWeek(date))
}
