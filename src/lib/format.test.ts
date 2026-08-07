import { describe, expect, it } from 'vitest'
import { formatMonthLabel, formatTime, formatWeekLabel } from './format'

describe('formatWeekLabel', () => {
  it('renders a compact month-and-day label for the week\'s Monday', () => {
    expect(formatWeekLabel('2026-07-13')).toBe('Jul 13')
  })

  it('is as compact as formatMonthLabel', () => {
    expect(formatWeekLabel('2026-08-03').length).toBeLessThanOrEqual(formatMonthLabel('2026-08').length + 3)
  })
})

describe('formatTime', () => {
  it('renders hour:minute with an AM/PM suffix', () => {
    expect(formatTime(new Date(2026, 6, 15, 15, 45).toISOString())).toBe('3:45 PM')
  })

  it('pads single-digit minutes', () => {
    expect(formatTime(new Date(2026, 6, 15, 9, 5).toISOString())).toBe('9:05 AM')
  })
})
