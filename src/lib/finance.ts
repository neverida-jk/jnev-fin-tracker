import type { Account, Category, Transaction, Transfer } from '../db'
import { currentMonthKey, currentWeekKey, startOfWeek, todayISO } from './dates'

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

/** Investment accounts (e.g. a brokerage funded for ETF/stock investing) are
 * excluded from net worth — their real value moves with market prices and
 * fees across positions this app was never meant to track trade-by-trade,
 * so carrying forward the last transferred-in peso amount as "net worth"
 * would just be a stale, wrong number. The transfer that funded one still
 * correctly leaves the tracked accounts' balances; that's all this app
 * claims to know once the money crosses over. */
export function isNetWorthTracked(account: Account): boolean {
  return account.type !== 'investment'
}

/** Net amount actually moved into savings-type accounts this month — the
 * real, verifiable "saved" figure. Unspent income isn't automatically
 * "saved" just because it hasn't been spent yet; this only counts money
 * that's actually been transferred somewhere set aside for it, and nets out
 * a withdrawal from savings the same month (same as a bank statement
 * would). Transfers where both sides (or neither) are savings accounts net
 * to no change either way. */
export function netTransferredToSavings(accounts: Account[], transfers: Transfer[], monthKey: string): number {
  const savingsAccountIds = new Set(accounts.filter((a) => a.type === 'savings').map((a) => a.id))
  return transfers
    .filter((tr) => tr.date.startsWith(monthKey))
    .reduce((sum, tr) => {
      const toSavings = savingsAccountIds.has(tr.toAccountId)
      const fromSavings = savingsAccountIds.has(tr.fromAccountId)
      if (toSavings && !fromSavings) return sum + tr.amount
      if (fromSavings && !toSavings) return sum - tr.amount
      return sum
    }, 0)
}

export function netWorth(
  accounts: Account[],
  transactions: Transaction[],
  transfers: Transfer[],
  categoriesById: Map<number, Category>,
): number {
  return accounts
    .filter(isNetWorthTracked)
    .reduce((sum, account) => sum + accountBalance(account, transactions, transfers, categoriesById), 0)
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

/** Sums this category's transaction amounts within the Monday-Sunday week
 * containing `today` — mirrors spentByCategoryThisMonth exactly but bucketed
 * by week instead of month. */
export function spentByCategoryThisWeek(
  transactions: Transaction[],
  categoryId: number,
  today: Date = new Date(),
): number {
  const weekStart = startOfWeek(today)
  const weekStartKey = todayISO(weekStart)
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6)
  const weekEndKey = todayISO(weekEnd)
  return transactions
    .filter((t) => t.categoryId === categoryId && t.date >= weekStartKey && t.date <= weekEndKey)
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

/** Days left in the current Monday-start calendar week, including today —
 * mirrors daysLeftInMonth for weekly budgets/allowances. */
export function daysLeftInWeek(today: Date = new Date()): number {
  const jsDay = today.getDay() // 0 = Sunday .. 6 = Saturday
  const isoDay = jsDay === 0 ? 7 : jsDay // 1 = Monday .. 7 = Sunday
  return Math.max(1, 8 - isoDay)
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
  transfers: Transfer[],
  categoriesById: Map<number, Category>,
  monthsBack = 6,
  today: Date = new Date(),
): MonthlyPoint[] {
  const trackedIds = new Set(accounts.filter(isNetWorthTracked).map((a) => a.id))
  const startingTotal = accounts.filter(isNetWorthTracked).reduce((sum, a) => sum + a.startingBalance, 0)
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

    // Transfers between two tracked accounts cancel out (money just moves
    // within what's counted). A transfer crossing into/out of an untracked
    // (investment) account is a real change to the tracked total — same
    // effect as an expense/income would have, so it can't be ignored the
    // way a same-side transfer safely is.
    for (const tr of transfers) {
      if (tr.date > monthEndKey) continue
      const fromTracked = trackedIds.has(tr.fromAccountId)
      const toTracked = trackedIds.has(tr.toAccountId)
      if (fromTracked && !toTracked) cumulativeNet -= tr.amount
      else if (!fromTracked && toTracked) cumulativeNet += tr.amount
    }

    points.push({ monthKey, income, expense, netWorth: startingTotal + cumulativeNet })
  }

  return points
}

export interface WeeklyPoint {
  weekKey: string
  income: number
  expense: number
}

/** Mirrors buildMonthlySeries' structure and logic exactly but bucketed by
 * week (via startOfWeek/currentWeekKey) instead of month. Net worth is
 * intentionally out of scope for weekly buckets — a slow cumulative metric
 * where weekly noise wouldn't be useful — so unlike MonthlyPoint, WeeklyPoint
 * carries no netWorth field and `accounts` (kept only for call-shape parity
 * with buildMonthlySeries) is unused here. */
export function buildWeeklySeries(
  _accounts: Account[],
  transactions: Transaction[],
  categoriesById: Map<number, Category>,
  weeksBack = 8,
  today: Date = new Date(),
): WeeklyPoint[] {
  const points: WeeklyPoint[] = []

  for (let i = weeksBack - 1; i >= 0; i--) {
    const weekAnchor = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i * 7)
    const weekStart = startOfWeek(weekAnchor)
    const weekKey = currentWeekKey(weekStart)
    const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6)
    const weekEndKey = todayISO(weekEnd)

    let income = 0
    let expense = 0

    for (const t of transactions) {
      const category = categoriesById.get(t.categoryId)
      if (!category) continue
      if (t.date >= weekKey && t.date <= weekEndKey && !category.system) {
        if (category.kind === 'income') income += t.amount
        else expense += t.amount
      }
    }

    points.push({ weekKey, income, expense })
  }

  return points
}
