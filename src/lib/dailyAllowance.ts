import type { Budget, Transaction } from '../db'
import { daysLeftInMonth, daysLeftInWeek, spentByCategoryThisMonth, spentByCategoryThisWeek } from './finance'

export interface DailyAllowance {
  amountPerDay: number | null
  reason: string
}

const NO_BUDGETS_REASON = 'Set a budget to see your daily spending allowance'
const FULLY_SPENT_REASON = 'Your budgets are fully spent for now'

/** Neobank-style "safe to spend today" figure: remaining headroom across all
 * budgets, spread over each budget's OWN remaining period. A weekly budget's
 * headroom is spread over days left in the week and a monthly one's over
 * days left in the month, then those per-day rates are summed — not pooled
 * into one total and divided by one day-count, since budgets can now mix
 * weekly and monthly periods. Never fabricates a number when there's
 * nothing real to base it on — matches the "never invent a number"
 * convention used throughout financialContext.ts and anomalyDetection.ts.
 * amountPerDay is only null when there are no budgets at all; once budgets
 * exist, 0 is itself a real, honestly-computed answer (fully spent), not a
 * missing one. */
export function computeDailyAllowance(
  budgets: Budget[],
  transactions: Transaction[],
  today: Date = new Date(),
): DailyAllowance {
  if (budgets.length === 0) {
    return { amountPerDay: null, reason: NO_BUDGETS_REASON }
  }

  const amountPerDay = budgets.reduce((sum, budget) => {
    const spent =
      budget.period === 'weekly'
        ? spentByCategoryThisWeek(transactions, budget.categoryId, today)
        : spentByCategoryThisMonth(transactions, budget.categoryId, today)
    const headroom = Math.max(0, budget.limit - spent)
    const daysLeft = budget.period === 'weekly' ? daysLeftInWeek(today) : daysLeftInMonth(today)
    return sum + headroom / daysLeft
  }, 0)

  if (amountPerDay === 0) {
    return { amountPerDay: 0, reason: FULLY_SPENT_REASON }
  }

  return {
    amountPerDay,
    reason: 'Based on what is left in your budgets for their current periods',
  }
}
