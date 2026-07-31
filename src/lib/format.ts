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
