import type { Budget, Transaction } from '../db'
import { daysLeftInMonth, spentByCategoryThisMonth } from './finance'

export interface DailyAllowance {
  amountPerDay: number | null
  reason: string
}

const NO_BUDGETS_REASON = 'Set a budget to see your daily spending allowance'
const FULLY_SPENT_REASON = 'Your budgets are fully spent for the month'

/** Neobank-style "safe to spend today" figure: total remaining headroom
 * across all budgets, spread evenly over the days left in the month. Never
 * fabricates a number when there's nothing real to base it on — matches the
 * "never invent a number" convention used throughout financialContext.ts and
 * anomalyDetection.ts. amountPerDay is only null when there are no budgets at
 * all; once budgets exist, 0 is itself a real, honestly-computed answer
 * (fully spent), not a missing one. */
export function computeDailyAllowance(
  budgets: Budget[],
  transactions: Transaction[],
  today: Date = new Date(),
): DailyAllowance {
  if (budgets.length === 0) {
    return { amountPerDay: null, reason: NO_BUDGETS_REASON }
  }

  const totalHeadroom = budgets.reduce((sum, budget) => {
    const spent = spentByCategoryThisMonth(transactions, budget.categoryId, today)
    return sum + Math.max(0, budget.monthlyLimit - spent)
  }, 0)

  if (totalHeadroom === 0) {
    return { amountPerDay: 0, reason: FULLY_SPENT_REASON }
  }

  const amountPerDay = totalHeadroom / daysLeftInMonth(today)
  return {
    amountPerDay,
    reason: 'Based on what is left in your budgets for the rest of the month',
  }
}
