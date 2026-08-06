import { describe, expect, it } from 'vitest'
import type { Budget, Transaction } from '../db'
import { computeDailyAllowance } from './dailyAllowance'

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    accountId: 1,
    categoryId: 1,
    amount: 100,
    date: '2026-08-01',
    note: '',
    createdAt: '',
    ...overrides,
  }
}

function budget(overrides: Partial<Budget> = {}): Budget {
  return { id: 1, categoryId: 1, period: 'monthly', limit: 1000, ...overrides }
}

describe('computeDailyAllowance', () => {
  it('returns null with a fallback reason when there are no budgets', () => {
    const result = computeDailyAllowance([], [], new Date('2026-08-06'))
    expect(result.amountPerDay).toBeNull()
    expect(result.reason).toBe('Set a budget to see your daily spending allowance')
  })

  it('divides total remaining headroom across the days left in the month for monthly budgets', () => {
    // August 2026 has 31 days; "today" is Aug 6, so 26 days are left
    // (max(1, 31 - 6 + 1)).
    const today = new Date('2026-08-06')
    const budgets = [
      budget({ id: 1, categoryId: 1, period: 'monthly', limit: 1000 }),
      budget({ id: 2, categoryId: 2, period: 'monthly', limit: 2000 }),
    ]
    const transactions = [
      tx({ id: 1, categoryId: 1, amount: 300, date: '2026-08-02' }), // headroom 700
      tx({ id: 2, categoryId: 2, amount: 500, date: '2026-08-03' }), // headroom 1500
      tx({ id: 3, categoryId: 1, amount: 999, date: '2026-07-15' }), // different month, ignored
    ]
    const result = computeDailyAllowance(budgets, transactions, today)
    // Same days-left denominator for both (both monthly), so pooling first vs
    // dividing-then-summing gives the same result: total headroom = 700 +
    // 1500 = 2200; days left = 26.
    expect(result.amountPerDay).toBeCloseTo(2200 / 26, 5)
    expect(result.reason).toMatch(/current periods/i)
  })

  it('returns exactly 0 (not null) when every budget is fully spent', () => {
    const today = new Date('2026-08-06')
    const budgets = [budget({ id: 1, categoryId: 1, period: 'monthly', limit: 500 })]
    const transactions = [
      tx({ id: 1, categoryId: 1, amount: 600, date: '2026-08-02' }), // overspent, clamped to 0 headroom
    ]
    const result = computeDailyAllowance(budgets, transactions, today)
    expect(result.amountPerDay).toBe(0)
    expect(result.reason).toBe('Your budgets are fully spent for now')
  })

  it('judges a weekly budget against this week (not this month) and sums per-budget daily rates for a mix of periods', () => {
    // Thursday Aug 6, 2026 — Monday-start week is Aug 3-9 (4 days left
    // including today: Thu/Fri/Sat/Sun -> max(1, 8 - 4) = 4). August has 31
    // days, so 26 days left in the month (max(1, 31 - 6 + 1)).
    const today = new Date('2026-08-06')
    const budgets = [
      budget({ id: 1, categoryId: 1, period: 'weekly', limit: 700 }),
      budget({ id: 2, categoryId: 2, period: 'monthly', limit: 2000 }),
    ]
    const transactions = [
      tx({ id: 1, categoryId: 1, amount: 200, date: '2026-08-05' }), // this week -> weekly headroom 500
      tx({ id: 2, categoryId: 1, amount: 999, date: '2026-07-20' }), // prior week/month, ignored for the weekly budget
      tx({ id: 3, categoryId: 2, amount: 500, date: '2026-08-03' }), // this month -> monthly headroom 1500
    ]
    const result = computeDailyAllowance(budgets, transactions, today)
    // Summed as independent per-day rates (500/4 + 1500/26), NOT pooled as
    // (500+1500)/one-day-count — the two periods have different day counts.
    expect(result.amountPerDay).toBeCloseTo(500 / 4 + 1500 / 26, 5)
  })
})
