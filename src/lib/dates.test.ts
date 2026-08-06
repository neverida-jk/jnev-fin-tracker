import { describe, expect, it } from 'vitest'
import { currentWeekKey, startOfWeek, todayISO } from './dates'

describe('startOfWeek', () => {
  it('returns the same date when given a Monday', () => {
    expect(startOfWeek(new Date(2026, 6, 13)).toDateString()).toBe(new Date(2026, 6, 13).toDateString())
  })

  it('rolls a mid-week date back to that week\'s Monday', () => {
    // 2026-07-15 is a Wednesday
    expect(todayISO(startOfWeek(new Date(2026, 6, 15)))).toBe('2026-07-13')
  })

  it('rolls a Sunday back to that week\'s Monday (not the next week\'s)', () => {
    // 2026-08-02 is a Sunday
    expect(todayISO(startOfWeek(new Date(2026, 7, 2)))).toBe('2026-07-27')
  })

  it('handles a week that crosses a month boundary', () => {
    // 2026-08-01 is a Saturday, in the week starting 2026-07-27
    expect(todayISO(startOfWeek(new Date(2026, 7, 1)))).toBe('2026-07-27')
  })
})

describe('currentWeekKey', () => {
  it('returns the ISO date of that week\'s Monday', () => {
    expect(currentWeekKey(new Date(2026, 6, 15))).toBe('2026-07-13')
  })

  it('defaults to today when no date is given', () => {
    expect(currentWeekKey()).toBe(todayISO(startOfWeek(new Date())))
  })
})
