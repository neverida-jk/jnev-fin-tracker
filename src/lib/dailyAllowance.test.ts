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
  return { id: 1, categoryId: 1, monthlyLimit: 1000, ...overrides }
}

describe('computeDailyAllowance', () => {
  it('returns null with a fallback reason when there are no budgets', () => {
    const result = computeDailyAllowance([], [], new Date('2026-08-06'))
    expect(result.amountPerDay).toBeNull()
    expect(result.reason).toBe('Set a budget to see your daily spending allowance')
  })

  it('divides total remaining headroom across the days left in the month', () => {
    // August 2026 has 31 days; "today" is Aug 6, so 26 days are left
    // (max(1, 31 - 6 + 1)).
    const today = new Date('2026-08-06')
    const budgets = [
      budget({ id: 1, categoryId: 1, monthlyLimit: 1000 }),
      budget({ id: 2, categoryId: 2, monthlyLimit: 2000 }),
    ]
    const transactions = [
      tx({ id: 1, categoryId: 1, amount: 300, date: '2026-08-02' }), // headroom 700
      tx({ id: 2, categoryId: 2, amount: 500, date: '2026-08-03' }), // headroom 1500
      tx({ id: 3, categoryId: 1, amount: 999, date: '2026-07-15' }), // different month, ignored
    ]
    const result = computeDailyAllowance(budgets, transactions, today)
    // total headroom = 700 + 1500 = 2200; days left = 26
    expect(result.amountPerDay).toBeCloseTo(2200 / 26, 5)
    expect(result.reason).toMatch(/rest of the month/i)
  })

  it('returns exactly 0 (not null) when every budget is fully spent', () => {
    const today = new Date('2026-08-06')
    const budgets = [budget({ id: 1, categoryId: 1, monthlyLimit: 500 })]
    const transactions = [
      tx({ id: 1, categoryId: 1, amount: 600, date: '2026-08-02' }), // overspent, clamped to 0 headroom
    ]
    const result = computeDailyAllowance(budgets, transactions, today)
    expect(result.amountPerDay).toBe(0)
    expect(result.reason).toBe('Your budgets are fully spent for the month')
  })
})
