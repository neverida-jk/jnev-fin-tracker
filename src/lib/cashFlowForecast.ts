import type { Account, Category, PayoutDate, PayoutSchedule, RecurringBill, Transaction, Transfer } from '../db'
import { netWorth, buildMonthlySeries } from './finance'
import { getBillsThisMonth } from './bills'
import { getNextUpcomingPayoutDate } from './payout'
import { todayISO } from './dates'
import { formatMoney } from './format'

export interface CashFlowDay {
  date: string // ISO yyyy-MM-dd
  balance: number
}

export interface CashFlowForecast {
  days: CashFlowDay[] // today through payday, inclusive, oldest first
  paydayDate: string
  paydayBalance: number
  lowestDate: string
  lowestBalance: number
  /** Estimated everyday (non-bill) spend per day, used to project days with
   * no bill due — see computeCashFlowForecast's doc comment for how it's
   * derived. */
  dailyRate: number
}

/** Projects tracked balance (see isNetWorthTracked — investments excluded,
 * same definition as the Net Worth tile) forward from today to the next
 * scheduled payout, so a coming shortfall shows up before it happens
 * instead of after.
 *
 * Two components, added per day so bill amounts aren't double-counted:
 *   1. Known bills/one-time bills due between today and payday, on their
 *      actual due dates (from getBillsThisMonth).
 *   2. An "everything else" daily rate: last completed month's total
 *      expense minus what active monthly bills account for, spread evenly
 *      over that month's days. This is a real number from real history,
 *      never a guess — if there's no completed month yet, it's 0 rather
 *      than fabricated.
 *
 * Returns null if there's no upcoming payout scheduled — there's nothing
 * to project toward.
 *
 * Known simplification: a monthly bill whose next occurrence falls in the
 * month after payday (rare given this app's semi-monthly payout cadence)
 * isn't rolled forward — getBillsThisMonth only resolves this month's due
 * date. */
export function computeCashFlowForecast(
  accounts: Account[],
  categories: Category[],
  transactions: Transaction[],
  transfers: Transfer[],
  bills: RecurringBill[],
  schedules: PayoutSchedule[],
  payoutDates: PayoutDate[],
  today: Date = new Date(),
): CashFlowForecast | null {
  const nextPayout = getNextUpcomingPayoutDate(schedules, payoutDates, today)
  if (!nextPayout) return null

  const categoriesById = new Map(categories.map((c) => [c.id, c]))
  const currentBalance = netWorth(accounts, transactions, transfers, categoriesById)

  const [lastCompleteMonth] = buildMonthlySeries(accounts, transactions, transfers, categoriesById, 2, today)
  const [y, m] = lastCompleteMonth.monthKey.split('-').map(Number)
  const daysInLastMonth = new Date(y, m, 0).getDate()
  const monthlyBillsTotal = bills
    .filter((b) => b.active && b.frequency === 'monthly')
    .reduce((sum, b) => sum + b.amount, 0)
  const dailyRate = Math.max(0, (lastCompleteMonth.expense - monthlyBillsTotal) / daysInLastMonth)

  const paydayKey = nextPayout.payoutDate.date
  const dueByDate = new Map<string, number>()
  for (const { bill, dueDate, paidThisMonth } of getBillsThisMonth(bills, today)) {
    if (paidThisMonth) continue
    const dueKey = todayISO(dueDate)
    if (dueKey < todayISO(today) || dueKey > paydayKey) continue
    dueByDate.set(dueKey, (dueByDate.get(dueKey) ?? 0) + bill.amount)
  }

  const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days: CashFlowDay[] = [{ date: todayISO(todayDateOnly), balance: currentBalance }]
  let balance = currentBalance
  const cursor = new Date(todayDateOnly)
  while (todayISO(cursor) < paydayKey) {
    cursor.setDate(cursor.getDate() + 1)
    const iso = todayISO(cursor)
    balance -= dailyRate
    balance -= dueByDate.get(iso) ?? 0
    days.push({ date: iso, balance })
  }

  const lowest = days.reduce((min, d) => (d.balance < min.balance ? d : min), days[0])
  const payday = days[days.length - 1]

  return {
    days,
    paydayDate: paydayKey,
    paydayBalance: payday.balance,
    lowestDate: lowest.date,
    lowestBalance: lowest.balance,
    dailyRate,
  }
}

function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** One-sentence summary of a forecast — distilled for a persistent,
 * glanceable spot rather than an on-demand question, matching
 * composeSuggestedSavings' role for savings. */
export function composeCashFlowForecast(forecast: CashFlowForecast): string {
  if (forecast.lowestBalance < 0) {
    return `Based on your recent spending and upcoming bills, you're projected to run short by ${formatMoney(Math.abs(forecast.lowestBalance))} around ${formatDateLabel(forecast.lowestDate)} — before your next payout on ${formatDateLabel(forecast.paydayDate)}.`
  }
  return `You're projected to have ${formatMoney(forecast.paydayBalance)} by your next payout on ${formatDateLabel(forecast.paydayDate)}, based on your recent spending and upcoming bills.`
}
