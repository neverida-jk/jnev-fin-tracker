import type { Category, Transaction } from '../db'
import { averageMonthlySpend, spentByCategoryThisMonth } from './finance'
import { currentMonthKey } from './dates'
import { formatMoney } from './format'

// How many standard deviations above the historical monthly mean this
// month's spend-so-far needs to be before it's flagged as unusual. 1.5-2
// standard deviations is the conventional rule-of-thumb band for calling
// something a statistical outlier without being trigger-happy on ordinary
// month-to-month variance — we use 1.75 as the middle of that range.
const STDDEV_ALERT_THRESHOLD = 1.75

// With fewer than MIN_MONTHS_FOR_STDDEV completed months of history, a
// standard deviation isn't meaningful (2 data points can't describe a
// "spread"). For that thinner-history band we fall back to a much blunter
// heuristic: is spend-so-far already more than this many times the typical
// monthly total?
const FALLBACK_MULTIPLE_THRESHOLD = 2

// Need at least this many completed months (excluding the current,
// in-progress one) before trusting a real standard deviation.
const MIN_MONTHS_FOR_STDDEV = 3

// Below this many completed months, skip the category entirely — even the
// blunt fallback heuristic isn't reliable off a single month of data, and
// flagging it would just be noise.
const MIN_MONTHS_FOR_FALLBACK = 2

// Cap on how many categories to surface at once — keeps the dashboard
// insight focused on the one or two things most worth a look.
const MAX_RESULTS = 2

export interface UnusualSpendCategory {
  categoryId: number
  categoryName: string
  spentThisMonth: number
  /** Mean of past completed months for this category (via averageMonthlySpend). */
  typicalMonthlySpend: number
  monthsOfHistory: number
  method: 'stddev' | 'fallback-multiple'
  message: string
}

/** Per-month totals for a category, excluding the given (current) month.
 * A small local helper purely to get the spread of past months for the
 * standard-deviation check below — the mean itself always comes from
 * averageMonthlySpend, so there's a single source of truth for "typical". */
function pastMonthlyTotals(transactions: Transaction[], categoryId: number, excludeMonthKey: string): number[] {
  const monthly = new Map<string, number>()
  for (const t of transactions) {
    if (t.categoryId !== categoryId) continue
    const monthKey = t.date.slice(0, 7)
    if (monthKey === excludeMonthKey) continue
    monthly.set(monthKey, (monthly.get(monthKey) ?? 0) + t.amount)
  }
  return [...monthly.values()]
}

function populationStdDev(values: number[], mean: number): number {
  if (values.length === 0) return 0
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

/**
 * Flags up to two expense categories whose spend so far this month is
 * significantly above their historical norm.
 *
 * - With MIN_MONTHS_FOR_STDDEV+ completed months of history: "significant"
 *   means more than STDDEV_ALERT_THRESHOLD standard deviations above the
 *   mean of those months.
 * - With MIN_MONTHS_FOR_FALLBACK to MIN_MONTHS_FOR_STDDEV-1 months: falls
 *   back to a simpler "more than FALLBACK_MULTIPLE_THRESHOLDx the average"
 *   heuristic, since a real standard deviation isn't trustworthy yet.
 * - With fewer than MIN_MONTHS_FOR_FALLBACK months: skipped outright.
 *
 * Every number returned is read straight from averageMonthlySpend /
 * spentByCategoryThisMonth or derived directly from their output — nothing
 * here is invented.
 */
export function detectUnusualSpend(
  transactions: Transaction[],
  categories: Category[],
  referenceDate: Date = new Date(),
): UnusualSpendCategory[] {
  const monthKey = currentMonthKey(referenceDate)
  const results: UnusualSpendCategory[] = []

  for (const category of categories) {
    if (category.kind !== 'expense' || category.system) continue

    const history = pastMonthlyTotals(transactions, category.id, monthKey)
    if (history.length < MIN_MONTHS_FOR_FALLBACK) continue

    const mean = averageMonthlySpend(transactions, category.id, monthKey)
    if (mean <= 0) continue

    const spent = spentByCategoryThisMonth(transactions, category.id, referenceDate)
    if (spent <= 0) continue

    if (history.length >= MIN_MONTHS_FOR_STDDEV) {
      const sd = populationStdDev(history, mean)
      if (sd <= 0) continue // no variance to compare against — everything's identical, nothing "unusual"
      const z = (spent - mean) / sd
      if (z > STDDEV_ALERT_THRESHOLD) {
        results.push({
          categoryId: category.id,
          categoryName: category.name,
          spentThisMonth: spent,
          typicalMonthlySpend: mean,
          monthsOfHistory: history.length,
          method: 'stddev',
          message: `${category.name} is unusually high this month: ${formatMoney(spent)} so far vs a typical ${formatMoney(mean)}/month.`,
        })
      }
    } else if (spent > mean * FALLBACK_MULTIPLE_THRESHOLD) {
      results.push({
        categoryId: category.id,
        categoryName: category.name,
        spentThisMonth: spent,
        typicalMonthlySpend: mean,
        monthsOfHistory: history.length,
        method: 'fallback-multiple',
        message: `${category.name} is already more than double its usual pace this month: ${formatMoney(spent)} so far vs a typical ${formatMoney(mean)}/month.`,
      })
    }
  }

  return results
    .sort((a, b) => b.spentThisMonth / b.typicalMonthlySpend - a.spentThisMonth / a.typicalMonthlySpend)
    .slice(0, MAX_RESULTS)
}
