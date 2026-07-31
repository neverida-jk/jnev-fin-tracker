import { describe, expect, it } from 'vitest'
import type { RecurringBill } from '../db'
import { getBillsThisMonth, getUpcomingUnpaidBills } from './bills'

// Feb 2026 is not a leap year (2026 % 4 !== 0) → 28 days, good for exercising
// the "clamp dueDay to the last day of a short month" behavior.
const FEB_15_2026 = new Date(2026, 1, 15)

function bill(overrides: Partial<RecurringBill> = {}): RecurringBill {
  return {
    id: 1,
    name: 'Rent',
    amount: 8000,
    dueDay: 1,
    accountId: 1,
    categoryId: 1,
    active: true,
    ...overrides,
  }
}

describe('getBillsThisMonth', () => {
  it('excludes inactive bills', () => {
    const result = getBillsThisMonth([bill({ active: false })], FEB_15_2026)
    expect(result).toEqual([])
  })

  it('clamps a dueDay past the end of a short month', () => {
    const result = getBillsThisMonth([bill({ dueDay: 31 })], FEB_15_2026)
    expect(result[0].dueDate.getDate()).toBe(28)
    expect(result[0].dueDate.getMonth()).toBe(1) // still February, not rolled into March
  })

  it('marks a bill as paid this month only when lastPaidMonth matches the current month key', () => {
    const paid = getBillsThisMonth([bill({ lastPaidMonth: '2026-02' })], FEB_15_2026)
    expect(paid[0].paidThisMonth).toBe(true)

    const unpaid = getBillsThisMonth([bill({ lastPaidMonth: '2026-01' })], FEB_15_2026)
    expect(unpaid[0].paidThisMonth).toBe(false)

    const neverPaid = getBillsThisMonth([bill({ lastPaidMonth: undefined })], FEB_15_2026)
    expect(neverPaid[0].paidThisMonth).toBe(false)
  })

  it('sorts by resolved due date ascending', () => {
    const bills = [
      bill({ id: 1, name: 'Late', dueDay: 25 }),
      bill({ id: 2, name: 'Early', dueDay: 3 }),
      bill({ id: 3, name: 'Mid', dueDay: 15 }),
    ]
    const result = getBillsThisMonth(bills, FEB_15_2026)
    expect(result.map((r) => r.bill.name)).toEqual(['Early', 'Mid', 'Late'])
  })
})

describe('getUpcomingUnpaidBills', () => {
  it('filters out bills already paid this month', () => {
    const bills = [
      bill({ id: 1, name: 'Paid', lastPaidMonth: '2026-02' }),
      bill({ id: 2, name: 'Unpaid', lastPaidMonth: '2026-01' }),
    ]
    const result = getUpcomingUnpaidBills(bills, FEB_15_2026)
    expect(result.map((r) => r.bill.name)).toEqual(['Unpaid'])
  })

  it('still excludes inactive bills even if otherwise unpaid', () => {
    const result = getUpcomingUnpaidBills([bill({ active: false })], FEB_15_2026)
    expect(result).toEqual([])
  })
})
