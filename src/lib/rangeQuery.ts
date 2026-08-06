import type { Category, Transaction } from '../db'
import { todayISO } from './dates'

/** Inclusive yyyy-MM-dd bounds for a time-range query, plus a short human
 * phrase (e.g. "last month") for reuse in answer text. */
export interface DateRange {
  start: string
  end: string
  label: string
}

const WORD_TO_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

const LAST_N_MONTHS_RE =
  /last\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months?/i

/**
 * Recognizes a handful of relative time-range phrasings inside free-form
 * text (case-insensitive substring match, since the caller may hand this a
 * full command sentence rather than an isolated phrase) and returns the
 * corresponding inclusive date range. Returns null when nothing matches, so
 * the caller can fall back to its existing this-month behavior.
 *
 * Recognized phrasings:
 *  - "this month"      -> 1st of the current calendar month through today
 *  - "last month"       -> the entire previous calendar month
 *  - "this year"        -> January 1st of the current year through today
 *  - "last year"        -> the entire previous calendar year
 *  - "last N months"    -> a rolling window of the N most recently
 *                          *completed* months (N as a digit or a small
 *                          number word, one..twelve; "month"/"months" both
 *                          accepted)
 */
export function parseRelativeRange(text: string, today: Date = new Date()): DateRange | null {
  const normalized = text.toLowerCase()
  const year = today.getFullYear()
  const month = today.getMonth() // 0-indexed

  // Checked first because "last month" (the fixed single-month phrase below)
  // never matches "last 3 months" anyway, but checking the more specific
  // pattern first keeps the intent obvious.
  const lastNMatch = normalized.match(LAST_N_MONTHS_RE)
  if (lastNMatch) {
    const raw = lastNMatch[1]
    const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : WORD_TO_NUM[raw]
    if (n && n > 0) {
      // Boundary rule: the current, still-in-progress month is never
      // included (mirrors averageMonthlySpend in finance.ts, which excludes
      // the current month so a partial month doesn't skew the number). The
      // window is the N calendar months immediately before the current one:
      // end = last day of the most recently completed month (day 0 of the
      // current month), start = the 1st of the month N-1 months before that.
      const end = new Date(year, month, 0)
      const start = new Date(year, month - n, 1)
      return {
        start: todayISO(start),
        end: todayISO(end),
        label: `last ${n} month${n === 1 ? '' : 's'}`,
      }
    }
  }

  if (normalized.includes('this month')) {
    const start = new Date(year, month, 1)
    return { start: todayISO(start), end: todayISO(today), label: 'this month' }
  }

  if (normalized.includes('last month')) {
    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 0)
    return { start: todayISO(start), end: todayISO(end), label: 'last month' }
  }

  if (normalized.includes('this year')) {
    const start = new Date(year, 0, 1)
    return { start: todayISO(start), end: todayISO(today), label: 'this year' }
  }

  if (normalized.includes('last year')) {
    const start = new Date(year - 1, 0, 1)
    const end = new Date(year - 1, 11, 31)
    return { start: todayISO(start), end: todayISO(end), label: 'last year' }
  }

  return null
}

/** Sums a single category's transaction amounts whose date falls within
 * [range.start, range.end] inclusive. Plain string comparison works since
 * yyyy-MM-dd sorts lexicographically — the same trick already used
 * throughout this codebase (see finance.ts). */
export function sumExpenseInRange(
  transactions: Transaction[],
  categoryId: number,
  range: DateRange,
): number {
  return transactions
    .filter(
      (t) => t.categoryId === categoryId && t.date >= range.start && t.date <= range.end,
    )
    .reduce((sum, t) => sum + t.amount, 0)
}

/** Sums ALL non-system expense-kind categories' transactions within the
 * range. */
export function totalExpenseInRange(
  transactions: Transaction[],
  categories: Category[],
  range: DateRange,
): number {
  const expenseCategoryIds = new Set(
    categories.filter((c) => c.kind === 'expense' && !c.system).map((c) => c.id),
  )
  return transactions
    .filter(
      (t) =>
        expenseCategoryIds.has(t.categoryId) && t.date >= range.start && t.date <= range.end,
    )
    .reduce((sum, t) => sum + t.amount, 0)
}

/** Ranks non-system expense categories by total spend within the range,
 * descending, excluding zero-spend categories. Returns at most `topN`
 * entries — an empty array when nothing qualifies, never a fabricated
 * ranking with no data. */
export function rankExpenseCategoriesInRange(
  transactions: Transaction[],
  categories: Category[],
  range: DateRange,
  topN = 1,
): { name: string; color: string; amount: number }[] {
  const expenseCategories = categories.filter((c) => c.kind === 'expense' && !c.system)

  return expenseCategories
    .map((c) => ({
      name: c.name,
      color: c.color,
      amount: sumExpenseInRange(transactions, c.id, range),
    }))
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, topN)
}
