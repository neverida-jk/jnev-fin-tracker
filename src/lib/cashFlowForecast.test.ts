import { describe, expect, it } from 'vitest'
import type { Account, Category, PayoutDate, PayoutSchedule, RecurringBill, Transaction } from '../db'
import { composeCashFlowForecast, computeCashFlowForecast } from './cashFlowForecast'

const gcash: Account = { id: 1, name: 'GCash', type: 'checking', startingBalance: 5000, createdAt: '' }
const groceries: Category = { id: 1, name: 'Groceries', kind: 'expense', color: '#f97316' }
const categories = [groceries]

// Thursday July 20, 2026 (some tests move this).
const TODAY = new Date(2026, 6, 20)

function tx(overrides: Partial<Transaction>): Transaction {
  return { id: Math.random(), accountId: 1, categoryId: groceries.id, amount: 0, date: '2026-06-15', note: '', createdAt: '', ...overrides }
}

function schedule(overrides: Partial<PayoutSchedule> = {}): PayoutSchedule {
  return { id: 1, label: 'Salary', accountId: 1, categoryId: 2, active: true, ...overrides }
}

function payoutDate(overrides: Partial<PayoutDate> = {}): PayoutDate {
  return { id: 1, scheduleId: 1, date: '2026-07-31', ...overrides }
}

function rentBill(overrides: Partial<RecurringBill> = {}): RecurringBill {
  return { id: 1, name: 'Rent', amount: 1000, frequency: 'monthly', dueDay: 25, accountId: 1, categoryId: groceries.id, active: true, ...overrides }
}

describe('computeCashFlowForecast', () => {
  it('returns null when there is no upcoming payout scheduled', () => {
    const result = computeCashFlowForecast([gcash], categories, [tx({ amount: 3000 })], [], [], [], [], TODAY)
    expect(result).toBeNull()
  })

  it('projects a declining balance day by day, dropping by the bill amount on its due date', () => {
    const transactions = [tx({ amount: 3000, date: '2026-06-15' })] // June: 3000 total expense
    const result = computeCashFlowForecast(
      [gcash],
      categories,
      transactions,
      [],
      [rentBill()],
      [schedule()],
      [payoutDate({ date: '2026-07-31' })],
      TODAY,
    )
    expect(result).not.toBeNull()
    if (!result) return

    // currentBalance = 5000 - 3000 = 2000. dailyRate = (3000 - 1000 rent)/30 = 66.667.
    expect(result.days[0]).toEqual({ date: '2026-07-20', balance: 2000 })
    expect(result.dailyRate).toBeCloseTo(2000 / 30, 5)

    const jul25 = result.days.find((d) => d.date === '2026-07-25')!
    const jul24 = result.days.find((d) => d.date === '2026-07-24')!
    // The rent bill (1000) lands as an extra drop exactly on its due date.
    expect(jul24.balance - jul25.balance).toBeCloseTo(1000 + 2000 / 30, 5)

    expect(result.paydayDate).toBe('2026-07-31')
    // 11 days of dailyRate plus the one rent payment.
    expect(result.paydayBalance).toBeCloseTo(2000 - 11 * (2000 / 30) - 1000, 5)
  })

  it('picks the lowest point in the projection, not just the payday balance', () => {
    // Balance only ever goes down here (no income arrives before payday), so
    // the lowest point is payday itself.
    const transactions = [tx({ amount: 3000, date: '2026-06-15' })]
    const result = computeCashFlowForecast(
      [gcash],
      categories,
      transactions,
      [],
      [rentBill()],
      [schedule()],
      [payoutDate({ date: '2026-07-31' })],
      TODAY,
    )
    expect(result?.lowestDate).toBe(result?.paydayDate)
    expect(result?.lowestBalance).toBeCloseTo(result?.paydayBalance ?? NaN, 5)
  })

  it('projects a shortfall (negative balance) when spending outpaces what is left', () => {
    const transactions = [tx({ amount: 30000, date: '2026-06-15' })] // huge historical spend
    const result = computeCashFlowForecast(
      [{ ...gcash, startingBalance: 1000 }],
      categories,
      transactions,
      [],
      [],
      [schedule()],
      [payoutDate({ date: '2026-07-31' })],
      TODAY,
    )
    expect(result?.lowestBalance).toBeLessThan(0)
  })

  it('uses a 0 daily rate (never fabricates one) when there is no completed month of history', () => {
    const result = computeCashFlowForecast(
      [gcash],
      categories,
      [], // no transactions at all
      [],
      [],
      [schedule()],
      [payoutDate({ date: '2026-07-31' })],
      TODAY,
    )
    expect(result?.dailyRate).toBe(0)
    expect(result?.paydayBalance).toBe(5000) // starting balance, unchanged
  })

  it('excludes an inactive bill from both the daily-rate correction and the scheduled due-date drop', () => {
    const transactions = [tx({ amount: 3000, date: '2026-06-15' })]
    const result = computeCashFlowForecast(
      [gcash],
      categories,
      transactions,
      [],
      [rentBill({ active: false })],
      [schedule()],
      [payoutDate({ date: '2026-07-31' })],
      TODAY,
    )
    // dailyRate uses the full 3000 (no bill subtracted), and no discrete drop on the 25th.
    expect(result?.dailyRate).toBeCloseTo(3000 / 30, 5)
    const jul24 = result?.days.find((d) => d.date === '2026-07-24')
    const jul25 = result?.days.find((d) => d.date === '2026-07-25')
    expect((jul24?.balance ?? 0) - (jul25?.balance ?? 0)).toBeCloseTo(3000 / 30, 5)
  })
})

describe('composeCashFlowForecast', () => {
  it('describes a healthy projection', () => {
    const forecast = { days: [], paydayDate: '2026-07-31', paydayBalance: 500, lowestDate: '2026-07-31', lowestBalance: 500, dailyRate: 50 }
    expect(composeCashFlowForecast(forecast)).toContain('₱500.00')
    expect(composeCashFlowForecast(forecast)).toContain('Jul 31')
    expect(composeCashFlowForecast(forecast)).not.toContain('run short')
  })

  it('describes a projected shortfall', () => {
    const forecast = { days: [], paydayDate: '2026-07-31', paydayBalance: -300, lowestDate: '2026-07-28', lowestBalance: -300, dailyRate: 50 }
    const text = composeCashFlowForecast(forecast)
    expect(text).toContain('run short')
    expect(text).toContain('₱300.00')
    expect(text).toContain('Jul 28')
    expect(text).toContain('Jul 31')
  })
})
