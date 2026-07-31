const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export interface ParsedPayoutDate {
  date: string // ISO yyyy-MM-dd
  label: string
}

/**
 * Lenient parser for pasted payout-schedule tables, e.g. lines like
 * "No later than 4pm of August 10 (Mon)" or "31-Jul-26". Most companies'
 * semi-monthly schedules omit the year except when it rolls over (e.g. a
 * December payout landing in January), so this infers the year forward:
 * an explicit year in the line wins; otherwise the year only advances when
 * a line's month comes chronologically before the previous line's month.
 */
export function parsePayoutDates(text: string, baseYear: number): ParsedPayoutDate[] {
  const monthPattern = MONTHS.join('|')
  const re = new RegExp(`(${monthPattern})\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?`, 'i')

  let currentYear = baseYear
  let lastMonthIndex = -1
  const results: ParsedPayoutDate[] = []

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const match = line.match(re)
    if (!match) continue

    const monthIndex = MONTHS.findIndex((m) => m.toLowerCase() === match[1].toLowerCase())
    if (monthIndex === -1) continue
    const day = Number(match[2])
    const explicitYear = match[3] ? Number(match[3]) : undefined

    if (explicitYear) {
      currentYear = explicitYear
    } else if (lastMonthIndex !== -1 && monthIndex < lastMonthIndex) {
      currentYear += 1
    }
    lastMonthIndex = monthIndex

    const date = new Date(currentYear, monthIndex, day)
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`
    results.push({ date: iso, label: line })
  }

  return results
}
