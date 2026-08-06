import { describe, expect, it } from 'vitest'
import type { Category, Transaction } from '../db'
import {
  parseRelativeRange,
  rankExpenseCategoriesInRange,
  sumExpenseInRange,
  totalExpenseInRange,
  type DateRange,
} from './rangeQuery'

describe('parseRelativeRange', () => {
  it('resolves "this month" to the 1st of the current month through today', () => {
    const range = parseRelativeRange('this month', new Date(2026, 7, 6)) // Aug 6, 2026
    expect(range).toEqual({ start: '2026-08-01', end: '2026-08-06', label: 'this month' })
  })

  it('resolves "last month" to the entire previous calendar month', () => {
    const range = parseRelativeRange('last month', new Date(2026, 7, 6)) // Aug 6, 2026
    expect(range).toEqual({ start: '2026-07-01', end: '2026-07-31', label: 'last month' })
  })

  it('rolls "last month" back across a year boundary when run in January', () => {
    // Edge case: run near the very start of a month, where "last month" must
    // wrap both the month AND the year.
    const range = parseRelativeRange('last month', new Date(2027, 0, 1)) // Jan 1, 2027
    expect(range).toEqual({ start: '2026-12-01', end: '2026-12-31', label: 'last month' })
  })

  it('resolves "this year" to January 1st through today', () => {
    const range = parseRelativeRange('this year', new Date(2026, 7, 6))
    expect(range).toEqual({ start: '2026-01-01', end: '2026-08-06', label: 'this year' })
  })

  it('resolves "last year" to the entire previous calendar year', () => {
    const range = parseRelativeRange('last year', new Date(2026, 7, 6))
    expect(range).toEqual({ start: '2025-01-01', end: '2025-12-31', label: 'last year' })
  })

  it('resolves "last N months" (digit) to the N most recently completed months, excluding the current one', () => {
    // Spec example: today 2026-08-06, "last 3 months" -> 2026-05-01..2026-07-31
    const range = parseRelativeRange('how much did I spend in the last 3 months', new Date(2026, 7, 6))
    expect(range).toEqual({ start: '2026-05-01', end: '2026-07-31', label: 'last 3 months' })
  })

  it('resolves "last N months" (number word) the same way as the digit form', () => {
    const range = parseRelativeRange('last two months', new Date(2026, 7, 6))
    expect(range).toEqual({ start: '2026-06-01', end: '2026-07-31', label: 'last 2 months' })
  })

  it('accepts singular "last 1 month" and labels it without a trailing s', () => {
    const range = parseRelativeRange('last 1 month', new Date(2026, 7, 6))
    expect(range).toEqual({ start: '2026-07-01', end: '2026-07-31', label: 'last 1 month' })
  })

  it('matches "last N months" as a substring of a full sentence rather than requiring exact equality', () => {
    const range = parseRelativeRange('how much did i spend over the last six months please', new Date(2026, 7, 6))
    expect(range?.label).toBe('last 6 months')
  })

  it('never includes the current, still-in-progress month in a "last N months" window', () => {
    const range = parseRelativeRange('last 1 month', new Date(2026, 7, 6)) // Aug 6, 2026
    expect(range?.end).toBe('2026-07-31') // July, not August
  })

  it('returns null for "last 0 months" (malformed count) instead of a bogus range', () => {
    expect(parseRelativeRange('last 0 months', new Date(2026, 7, 6))).toBeNull()
  })

  it('returns null when no recognized phrasing is present', () => {
    expect(parseRelativeRange('yesterday', new Date(2026, 7, 6))).toBeNull()
    expect(parseRelativeRange('next month', new Date(2026, 7, 6))).toBeNull()
    expect(parseRelativeRange('how much did i spend on dining', new Date(2026, 7, 6))).toBeNull()
    expect(parseRelativeRange('', new Date(2026, 7, 6))).toBeNull()
  })

  it('is case-insensitive', () => {
    const range = parseRelativeRange('LAST MONTH', new Date(2026, 7, 6))
    expect(range?.label).toBe('last month')
  })
})

const GROCERIES: Category = { id: 1, name: 'Groceries', kind: 'expense', color: '#f00' }
const DINING: Category = { id: 2, name: 'Dining', kind: 'expense', color: '#f00' }
const TRANSPORT: Category = { id: 3, name: 'Transport', kind: 'expense', color: '#f00' }
const SALARY: Category = { id: 4, name: 'Salary', kind: 'income', color: '#0f0' }
const SYSTEM_ADJUSTMENT: Category = { id: 5, name: 'Balance Adjustment', kind: 'expense', color: '#999', system: true }

const categories: Category[] = [GROCERIES, DINING, TRANSPORT, SALARY, SYSTEM_ADJUSTMENT]

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return { id: 1, accountId: 1, categoryId: GROCERIES.id, amount: 100, date: '2026-06-15', note: '', createdAt: '', ...overrides }
}

// A range spanning June-July 2026, used across the sum/total/rank tests below.
const JUNE_JULY_RANGE: DateRange = { start: '2026-06-01', end: '2026-07-31', label: 'Jun-Jul 2026' }

const transactions: Transaction[] = [
  tx({ id: 1, categoryId: GROCERIES.id, date: '2026-05-20', amount: 500 }), // before range
  tx({ id: 2, categoryId: GROCERIES.id, date: '2026-06-01', amount: 300 }), // range start boundary
  tx({ id: 3, categoryId: GROCERIES.id, date: '2026-07-31', amount: 200 }), // range end boundary
  tx({ id: 4, categoryId: GROCERIES.id, date: '2026-08-01', amount: 999 }), // after range
  tx({ id: 5, categoryId: DINING.id, date: '2026-06-10', amount: 1000 }), // in range
  tx({ id: 6, categoryId: DINING.id, date: '2026-07-05', amount: 50 }), // in range
  tx({ id: 7, categoryId: SALARY.id, date: '2026-06-15', amount: 5000 }), // income, excluded from expense totals
  tx({ id: 8, categoryId: SYSTEM_ADJUSTMENT.id, date: '2026-06-15', amount: 9999 }), // system, excluded
  // Transport has no transactions at all in range -> must be excluded from ranking.
]

describe('sumExpenseInRange', () => {
  it('sums only the given category within the inclusive date bounds', () => {
    // Groceries in range: 300 (start boundary) + 200 (end boundary) = 500;
    // the 500 before and 999 after the range are excluded.
    expect(sumExpenseInRange(transactions, GROCERIES.id, JUNE_JULY_RANGE)).toBe(500)
  })

  it('includes transactions dated exactly on the start and end boundaries', () => {
    const tight: DateRange = { start: '2026-06-01', end: '2026-06-01', label: 'single day' }
    expect(sumExpenseInRange(transactions, GROCERIES.id, tight)).toBe(300)
  })

  it('returns 0 for a category with no transactions in range', () => {
    expect(sumExpenseInRange(transactions, TRANSPORT.id, JUNE_JULY_RANGE)).toBe(0)
  })

  it('returns 0 for an empty transaction list', () => {
    expect(sumExpenseInRange([], GROCERIES.id, JUNE_JULY_RANGE)).toBe(0)
  })
})

describe('totalExpenseInRange', () => {
  it('sums all non-system expense categories within the range, excluding income and system categories', () => {
    // Groceries 500 + Dining (1000 + 50) = 1550; Salary (income) and the
    // system Balance Adjustment category must not be counted.
    expect(totalExpenseInRange(transactions, categories, JUNE_JULY_RANGE)).toBe(1550)
  })

  it('returns 0 when nothing falls in range', () => {
    const farFuture: DateRange = { start: '2030-01-01', end: '2030-01-31', label: 'far future' }
    expect(totalExpenseInRange(transactions, categories, farFuture)).toBe(0)
  })

  it('returns 0 when there are no expense categories at all', () => {
    expect(totalExpenseInRange(transactions, [SALARY], JUNE_JULY_RANGE)).toBe(0)
  })
})

describe('rankExpenseCategoriesInRange', () => {
  it('ranks categories descending by spend and respects topN', () => {
    const top1 = rankExpenseCategoriesInRange(transactions, categories, JUNE_JULY_RANGE, 1)
    expect(top1).toEqual([{ name: 'Dining', color: DINING.color, amount: 1050 }])

    const top2 = rankExpenseCategoriesInRange(transactions, categories, JUNE_JULY_RANGE, 2)
    expect(top2).toEqual([
      { name: 'Dining', color: DINING.color, amount: 1050 },
      { name: 'Groceries', color: GROCERIES.color, amount: 500 },
    ])
  })

  it('excludes zero-spend categories even when topN would otherwise include them', () => {
    // Transport has 0 spend in range; even asking for the top 5 must not
    // surface it (or income/system categories) alongside the two real spenders.
    const top5 = rankExpenseCategoriesInRange(transactions, categories, JUNE_JULY_RANGE, 5)
    expect(top5).toHaveLength(2)
    expect(top5.map((r) => r.name)).not.toContain('Transport')
    expect(top5.map((r) => r.name)).not.toContain('Salary')
    expect(top5.map((r) => r.name)).not.toContain('Balance Adjustment')
  })

  it('returns an empty array (never a fabricated ranking) when no category has spend in range', () => {
    const farFuture: DateRange = { start: '2030-01-01', end: '2030-01-31', label: 'far future' }
    expect(rankExpenseCategoriesInRange(transactions, categories, farFuture, 1)).toEqual([])
  })

  it('defaults topN to 1 when not specified', () => {
    const ranked = rankExpenseCategoriesInRange(transactions, categories, JUNE_JULY_RANGE)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].name).toBe('Dining')
  })
})
