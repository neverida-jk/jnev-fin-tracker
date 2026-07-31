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
