import { describe, expect, it } from 'vitest'
import type { PayoutDate, PayoutSchedule } from '../db'
import { getNextPendingPayout, getNextUpcomingPayoutDate, getPendingPayoutDates } from './payout'

const TODAY = new Date('2026-07-31T12:00:00')

function schedule(overrides: Partial<PayoutSchedule> = {}): PayoutSchedule {
  return { id: 1, label: 'Salary', accountId: 1, categoryId: 1, active: true, ...overrides }
}

function payoutDate(overrides: Partial<PayoutDate> = {}): PayoutDate {
  return { id: 1, scheduleId: 1, date: '2026-07-01', ...overrides }
}

describe('getPendingPayoutDates', () => {
  it('returns empty when there are no schedules or payout dates', () => {
    expect(getPendingPayoutDates([], [], TODAY)).toEqual([])
  })

  it('includes a payout date that has arrived and is not logged', () => {
    const schedules = [schedule()]
    const dates = [payoutDate({ date: '2026-07-01' })]
    const result = getPendingPayoutDates(schedules, dates, TODAY)
    expect(result).toHaveLength(1)
    expect(result[0].payoutDate.id).toBe(1)
    expect(result[0].schedule.id).toBe(1)
  })

  it('treats a payout date equal to today as pending (boundary)', () => {
    const schedules = [schedule()]
    const dates = [payoutDate({ date: '2026-07-31' })]
    expect(getPendingPayoutDates(schedules, dates, TODAY)).toHaveLength(1)
  })

  it('excludes a payout date that has not arrived yet', () => {
    const schedules = [schedule()]
    const dates = [payoutDate({ date: '2026-08-01' })]
    expect(getPendingPayoutDates(schedules, dates, TODAY)).toEqual([])
  })

  it('excludes a payout date that has already been logged', () => {
    const schedules = [schedule()]
    const dates = [payoutDate({ date: '2026-07-01', loggedTransactionId: 99 })]
    expect(getPendingPayoutDates(schedules, dates, TODAY)).toEqual([])
  })

  it('excludes payout dates belonging to an inactive schedule', () => {
    const schedules = [schedule({ active: false })]
    const dates = [payoutDate({ date: '2026-07-01' })]
    expect(getPendingPayoutDates(schedules, dates, TODAY)).toEqual([])
  })

  it('excludes payout dates whose schedule no longer exists', () => {
    const dates = [payoutDate({ date: '2026-07-01', scheduleId: 999 })]
    expect(getPendingPayoutDates([schedule()], dates, TODAY)).toEqual([])
  })

  it('sorts pending payouts by date ascending', () => {
    const schedules = [schedule()]
    const dates = [
      payoutDate({ id: 1, date: '2026-07-20' }),
      payoutDate({ id: 2, date: '2026-07-05' }),
      payoutDate({ id: 3, date: '2026-07-15' }),
    ]
    const result = getPendingPayoutDates(schedules, dates, TODAY)
    expect(result.map((r) => r.payoutDate.id)).toEqual([2, 3, 1])
  })
})

describe('getNextPendingPayout', () => {
  it('returns undefined when nothing is pending', () => {
    expect(getNextPendingPayout([schedule()], [payoutDate({ loggedTransactionId: 1 })], TODAY)).toBeUndefined()
  })

  it('returns the earliest pending payout across multiple schedules', () => {
    const schedules = [schedule({ id: 1 }), schedule({ id: 2, label: 'Bonus' })]
    const dates = [
      payoutDate({ id: 1, scheduleId: 1, date: '2026-07-20' }),
      payoutDate({ id: 2, scheduleId: 2, date: '2026-07-05' }),
    ]
    const result = getNextPendingPayout(schedules, dates, TODAY)
    expect(result?.payoutDate.id).toBe(2)
    expect(result?.schedule.label).toBe('Bonus')
  })
})

describe('getNextUpcomingPayoutDate', () => {
  it('returns undefined when there is nothing in the future', () => {
    expect(getNextUpcomingPayoutDate([schedule()], [payoutDate({ date: '2026-07-31' })], TODAY)).toBeUndefined()
  })

  it('excludes today itself — only strictly future dates count as "upcoming"', () => {
    expect(getNextUpcomingPayoutDate([schedule()], [payoutDate({ date: '2026-07-31' })], TODAY)).toBeUndefined()
    expect(getNextUpcomingPayoutDate([schedule()], [payoutDate({ date: '2026-08-01' })], TODAY)).toBeDefined()
  })

  it('returns the earliest future date, regardless of logged status', () => {
    const schedules = [schedule()]
    const dates = [
      payoutDate({ id: 1, date: '2026-08-15' }),
      payoutDate({ id: 2, date: '2026-08-01', loggedTransactionId: 99 }),
    ]
    const result = getNextUpcomingPayoutDate(schedules, dates, TODAY)
    expect(result?.payoutDate.id).toBe(2)
  })

  it('excludes an inactive schedule', () => {
    expect(getNextUpcomingPayoutDate([schedule({ active: false })], [payoutDate({ date: '2026-08-01' })], TODAY)).toBeUndefined()
  })
})
