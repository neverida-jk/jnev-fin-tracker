// Change this if you're tracking a different currency.
export const CURRENCY = 'PHP'

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: CURRENCY,
  maximumFractionDigits: 2,
})

export function formatMoney(amount: number): string {
  return currencyFormatter.format(amount)
}

export function formatMonthLabel(yyyyMM: string): string {
  const [year, month] = yyyyMM.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  })
}

/** Compact chart-axis label for a week-bucket key (the ISO 'yyyy-MM-dd' of
 * that week's Monday) — e.g. "Aug 3". Mirrors the compactness of
 * formatMonthLabel. */
export function formatWeekLabel(weekKey: string): string {
  const [year, month, day] = weekKey.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

/** Full Mon-Sun span for a week-bucket key, e.g. "Mon Aug 3 - Sun Aug 9" —
 * spells out every day a "this week" figure covers, unlike formatWeekLabel's
 * single-date compactness for chart axis ticks. */
export function formatWeekRangeLabel(weekKey: string): string {
  const [year, month, day] = weekKey.split('-').map(Number)
  const start = new Date(year, month - 1, day)
  const end = new Date(year, month - 1, day + 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `Mon ${fmt(start)} - Sun ${fmt(end)}`
}
