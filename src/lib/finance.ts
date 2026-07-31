import type { Account, Category, Transaction, Transfer } from '../db'
import { currentMonthKey } from './dates'

export function signedAmount(amount: number, kind: Category['kind']): number {
  return kind === 'income' ? amount : -amount
}

export function accountBalance(
  account: Account,
  transactions: Transaction[],
  transfers: Transfer[],
  categoriesById: Map<number, Category>,
): number {
  const transactionNet = transactions
    .filter((t) => t.accountId === account.id)
    .reduce((sum, t) => {
      const category = categoriesById.get(t.categoryId)
      if (!category) return sum
      return sum + signedAmount(t.amount, category.kind)
    }, 0)

  const transferNet = transfers.reduce((sum, tr) => {
    if (tr.toAccountId === account.id) return sum + tr.amount
    if (tr.fromAccountId === account.id) return sum - tr.amount
    return sum
  }, 0)

  return account.startingBalance + transactionNet + transferNet
}

export function netWorth(
  accounts: Account[],
  transactions: Transaction[],
  transfers: Transfer[],
  categoriesById: Map<number, Category>,
): number {
  return accounts.reduce(
    (sum, account) => sum + accountBalance(account, transactions, transfers, categoriesById),
    0,
  )
}

export function spentByCategoryThisMonth(
  transactions: Transaction[],
  categoryId: number,
  today: Date = new Date(),
): number {
  const monthKey = currentMonthKey(today)
  return transactions
    .filter((t) => t.categoryId === categoryId && t.date.startsWith(monthKey))
    .reduce((sum, t) => sum + t.amount, 0)
}

/** Average of completed months' totals for a category — the current,
 * still-in-progress month is excluded so a partial month doesn't drag the
 * average down. Returns 0 if there's no history yet. */
export function averageMonthlySpend(
  transactions: Transaction[],
  categoryId: number,
  excludeMonthKey: string,
): number {
  const monthly = new Map<string, number>()
  for (const t of transactions) {
    if (t.categoryId !== categoryId) continue
    const monthKey = t.date.slice(0, 7)
    if (monthKey === excludeMonthKey) continue
    monthly.set(monthKey, (monthly.get(monthKey) ?? 0) + t.amount)
  }
  if (monthly.size === 0) return 0
  return [...monthly.values()].reduce((a, b) => a + b, 0) / monthly.size
}

export function daysLeftInMonth(today: Date = new Date()): number {
  const totalDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  return Math.max(1, totalDays - today.getDate() + 1)
}

export interface MonthlyPoint {
  monthKey: string
  income: number
  expense: number
  netWorth: number
}

export function buildMonthlySeries(
  accounts: Account[],
  transactions: Transaction[],
  categoriesById: Map<number, Category>,
  monthsBack = 6,
  today: Date = new Date(),
): MonthlyPoint[] {
  // Transfers move money between the user's own tracked accounts, so they
  // never change the total — safe to ignore them for the net worth trend.
  const startingTotal = accounts.reduce((sum, a) => sum + a.startingBalance, 0)
  const points: MonthlyPoint[] = []

  for (let i = monthsBack - 1; i >= 0; i--) {
    const monthDate = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const monthKey = currentMonthKey(monthDate)
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)
    const monthEndKey = monthEnd.toISOString().slice(0, 10)

    let income = 0
    let expense = 0
    let cumulativeNet = 0

    for (const t of transactions) {
      const category = categoriesById.get(t.categoryId)
      if (!category) continue
      if (t.date <= monthEndKey) {
        cumulativeNet += signedAmount(t.amount, category.kind)
      }
      if (t.date.startsWith(monthKey) && !category.system) {
        if (category.kind === 'income') income += t.amount
        else expense += t.amount
      }
    }

    points.push({ monthKey, income, expense, netWorth: startingTotal + cumulativeNet })
  }

  return points
}
