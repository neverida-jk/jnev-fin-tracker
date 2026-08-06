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
