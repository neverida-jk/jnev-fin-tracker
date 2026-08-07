import type { Account, Budget, Category, Transaction, Transfer } from '../db'
import {
  accountBalance,
  averageMonthlySpend,
  daysLeftInMonth,
  daysLeftInWeek,
  spentByCategoryThisMonth,
  spentByCategoryThisWeek,
  type MonthlyPoint,
  type WeeklyPoint,
} from './finance'
import { currentMonthKey } from './dates'
import { formatMoney } from './format'
import {
  BUDGET_RULE_50_30_20,
  BUDGET_RULE_TOLERANCE,
  IMPULSE_COOLDOWN_AMOUNT,
  PURCHASE_CAUTION_FRACTION,
} from './financialKnowledge'

// A compact snapshot of "how am I doing financially right now" — computed
// once per question from real local data. Every answer function below reads
// only from this (plus the fixed rules in financialKnowledge.ts), so nothing
// is ever invented — it's either your own number or a well-known guideline.
export interface FinancialContext {
  monthKey: string
  daysLeftInMonth: number
  daysLeftInWeek: number
  netWorth: number
  accounts: { name: string; balance: number }[]
  categories: {
    name: string
    kind: Category['kind']
    /** Expense-only "need" vs "want" per the 50/30/20 split. Undefined (income rows, or unclassified expenses) reads as "want". */
    isNeed?: boolean
    /** Undefined when no budget is set. When set, `period` says whether
     * `limit` should be compared against spentThisWeek or spentThisMonth —
     * a weekly budget's pace is always judged against the week, regardless
     * of any "this week / this month" view toggle elsewhere in the app. */
    budget?: { limit: number; period: Budget['period'] }
    spentThisMonth: number
    spentThisWeek: number
    avgMonthlyHistorical: number
  }[]
  incomeThisMonth: number
  expenseThisMonth: number
}

export function buildFinancialContext(
  accounts: Account[],
  categories: Category[],
  transactions: Transaction[],
  transfers: Transfer[],
  budgets: Budget[],
  today: Date = new Date(),
): FinancialContext {
  const categoriesById = new Map(categories.map((c) => [c.id, c]))
  const monthKey = currentMonthKey(today)

  const accountRows = accounts.map((a) => ({
    name: a.name,
    balance: accountBalance(a, transactions, transfers, categoriesById),
  }))

  const categoryRows = categories
    .filter((c) => !c.system)
    .map((c) => {
      const budget = budgets.find((b) => b.categoryId === c.id)
      return {
        name: c.name,
        kind: c.kind,
        isNeed: c.isNeed,
        budget: budget ? { limit: budget.limit, period: budget.period } : undefined,
        spentThisMonth: spentByCategoryThisMonth(transactions, c.id, today),
        spentThisWeek: spentByCategoryThisWeek(transactions, c.id, today),
        avgMonthlyHistorical: averageMonthlySpend(transactions, c.id, monthKey),
      }
    })

  return {
    monthKey,
    daysLeftInMonth: daysLeftInMonth(today),
    daysLeftInWeek: daysLeftInWeek(today),
    netWorth: accountRows.reduce((sum, a) => sum + a.balance, 0),
    accounts: accountRows,
    categories: categoryRows,
    incomeThisMonth: categoryRows.filter((c) => c.kind === 'income').reduce((sum, c) => sum + c.spentThisMonth, 0),
    expenseThisMonth: categoryRows.filter((c) => c.kind === 'expense').reduce((sum, c) => sum + c.spentThisMonth, 0),
  }
}

/** Picks the spend figure/day-count/label matching a budget's own period —
 * a weekly budget is always judged against this week's spend and days left
 * in the week, a monthly one against this month's, independent of any
 * "this week / this month" view toggle elsewhere in the app. */
function budgetProgress(
  cat: FinancialContext['categories'][number],
  context: FinancialContext,
): { spent: number; limit: number; daysLeft: number; periodWord: 'week' | 'month' } | undefined {
  if (!cat.budget) return undefined
  return cat.budget.period === 'weekly'
    ? { spent: cat.spentThisWeek, limit: cat.budget.limit, daysLeft: context.daysLeftInWeek, periodWord: 'week' }
    : { spent: cat.spentThisMonth, limit: cat.budget.limit, daysLeft: context.daysLeftInMonth, periodWord: 'month' }
}

/** The always-available, fully offline answer — a deterministic template
 * filled in with real numbers from `context`. Never invents a figure. Used
 * directly when no on-device AI is available, and as the guaranteed
 * fallback text handed to aiEngine.ts's generateNarrative(), which only
 * ever rephrases this text (native browser AI, then an opt-in local model)
 * and never alters the underlying numbers. */
export function composeLocalAnswer(context: FinancialContext, categoryName?: string): string {
  if (categoryName) {
    const cat = context.categories.find((c) => c.name === categoryName)
    if (!cat) return `I don't have a "${categoryName}" category to check yet.`

    const progress = budgetProgress(cat, context)
    if (progress) {
      const remaining = progress.limit - progress.spent
      if (remaining >= 0) {
        const perDay = remaining / progress.daysLeft
        const dayWord = progress.daysLeft === 1 ? 'day' : 'days'
        return `${cat.name}: ${formatMoney(remaining)} left of your ${formatMoney(progress.limit)} budget this ${progress.periodWord} (spent ${formatMoney(progress.spent)} so far) — about ${formatMoney(perDay)}/day for the next ${progress.daysLeft} ${dayWord}.`
      }
      return `You're ${formatMoney(Math.abs(remaining))} over your ${cat.name} budget this ${progress.periodWord} (spent ${formatMoney(progress.spent)} of ${formatMoney(progress.limit)}).`
    }

    if (cat.avgMonthlyHistorical > 0) {
      return `No budget set for ${cat.name} yet. You've spent ${formatMoney(cat.spentThisMonth)} so far this month; you've averaged about ${formatMoney(cat.avgMonthlyHistorical)}/month historically. Set a budget in the Budgets tab to track this.`
    }

    return cat.spentThisMonth > 0
      ? `No budget set for ${cat.name} yet. You've spent ${formatMoney(cat.spentThisMonth)} so far this month — set a budget in the Budgets tab to get a real answer next time.`
      : `No budget set for ${cat.name}, and no spending logged yet this month — log a few transactions and ask again.`
  }

  // General "what's a good budget for me" — no specific category named.
  const suggestions = context.categories
    .filter((c) => c.kind === 'expense' && c.avgMonthlyHistorical > 0)
    .sort((a, b) => b.avgMonthlyHistorical - a.avgMonthlyHistorical)

  if (suggestions.length === 0) {
    return 'Not enough transaction history yet to suggest a budget — log expenses for a few weeks and ask again.'
  }

  const total = suggestions.reduce((sum, s) => sum + s.avgMonthlyHistorical, 0)
  const breakdown = suggestions.map((s) => `${s.name} ${formatMoney(s.avgMonthlyHistorical)}`).join(', ')
  return `Based on your past spending: ${breakdown} (~${formatMoney(total)}/month total). Set these as budgets in the Budgets tab.`
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/** "How's my budget?" / "am I doing okay?" — checks this month's actual
 * needs/wants/savings split against the classic 50/30/20 guideline. */
export function composeBudgetHealthCheck(context: FinancialContext): string {
  if (context.incomeThisMonth <= 0) {
    return "No income logged yet this month, so I can't check your budget split against the 50/30/20 guideline (50% needs, 30% wants, 20% savings) — log your payout first."
  }

  const expenseCats = context.categories.filter((c) => c.kind === 'expense')
  const needsSpend = expenseCats.filter((c) => c.isNeed).reduce((s, c) => s + c.spentThisMonth, 0)
  const wantsSpend = expenseCats.filter((c) => !c.isNeed).reduce((s, c) => s + c.spentThisMonth, 0)
  const saved = context.incomeThisMonth - context.expenseThisMonth

  const needsPct = needsSpend / context.incomeThisMonth
  const wantsPct = wantsSpend / context.incomeThisMonth
  const savedPct = saved / context.incomeThisMonth

  const headline = `This month: needs ${formatMoney(needsSpend)} (${pct(needsPct)}), wants ${formatMoney(wantsSpend)} (${pct(wantsPct)}), saved ${formatMoney(saved)} (${pct(savedPct)}) of ${formatMoney(context.incomeThisMonth)} income.`

  const notes: string[] = []
  if (needsPct > BUDGET_RULE_50_30_20.needs + BUDGET_RULE_TOLERANCE) {
    notes.push(`needs are above the usual ${pct(BUDGET_RULE_50_30_20.needs)} guideline`)
  }
  if (wantsPct > BUDGET_RULE_50_30_20.wants + BUDGET_RULE_TOLERANCE) {
    notes.push(`wants are above the usual ${pct(BUDGET_RULE_50_30_20.wants)} guideline`)
  }
  if (savedPct < BUDGET_RULE_50_30_20.savings - BUDGET_RULE_TOLERANCE) {
    notes.push(`you're saving less than the usual ${pct(BUDGET_RULE_50_30_20.savings)} guideline`)
  }

  if (notes.length === 0) {
    return `${headline} That's right around the classic 50/30/20 guideline (needs/wants/savings) — looking healthy.`
  }
  return `${headline} Compared to the classic 50/30/20 guideline: ${notes.join('; ')}.`
}

/** "Should I buy this?" — checks a one-off purchase against the relevant
 * category's remaining budget (or its historical average if no budget is
 * set), plus the flat "sleep on anything ₱1,000+" cooldown rule of thumb. */
export function composePurchaseAdvice(context: FinancialContext, amount: number | undefined, categoryName?: string): string {
  if (!amount) {
    return "Tell me the price too — e.g. \"should i buy a 3000 phone case\" — and I'll check it against your budget."
  }

  const cooldownNote =
    amount >= IMPULSE_COOLDOWN_AMOUNT
      ? ` Since it's ${formatMoney(amount)}, the classic rule of thumb is to sleep on it a day or two before deciding.`
      : ''

  const cat = categoryName ? context.categories.find((c) => c.name === categoryName) : undefined
  if (cat) {
    const progress = budgetProgress(cat, context)
    const allowance = progress
      ? { limit: progress.limit, spent: progress.spent, periodWord: progress.periodWord }
      : cat.avgMonthlyHistorical > 0
        ? { limit: cat.avgMonthlyHistorical, spent: cat.spentThisMonth, periodWord: 'month' as const }
        : undefined
    if (allowance) {
      const remaining = allowance.limit - allowance.spent
      if (amount > remaining) {
        return `That would put you ${formatMoney(amount - remaining)} over what's left in ${cat.name} this ${allowance.periodWord} (${formatMoney(Math.max(remaining, 0))} left of ${formatMoney(allowance.limit)}) — I'd hold off or trim something else.${cooldownNote}`
      }
      if (amount > remaining * PURCHASE_CAUTION_FRACTION) {
        return `That's ${formatMoney(amount)} of the ${formatMoney(remaining)} you have left in ${cat.name} this ${allowance.periodWord} — doable, but it'll eat more than half of what's left.${cooldownNote}`
      }
      return `You have ${formatMoney(remaining)} left in ${cat.name} this ${allowance.periodWord}, so ${formatMoney(amount)} fits comfortably.${cooldownNote}`
    }
  }

  // No category, or no budget/history to check it against — fall back to
  // the flat cooldown rule plus a sanity check against overall net worth.
  if (context.netWorth > 0 && amount > context.netWorth * 0.5) {
    return `That's over half your current net worth (${formatMoney(context.netWorth)}) — worth thinking hard about before buying.${cooldownNote}`
  }
  return cooldownNote
    ? `I don't have a specific budget to check that against, but it's ${formatMoney(amount)}.${cooldownNote}`
    : `I don't have a specific budget to check that against, but ${formatMoney(amount)} isn't in cooldown-rule territory (under ₱${IMPULSE_COOLDOWN_AMOUNT.toLocaleString()}) — your call.`
}

// A category's budget is considered "worth calling out" once this much of
// it has already been used this month — high enough that it's a real
// heads-up rather than routine mid-month progress.
const BUDGET_PACE_ALERT_THRESHOLD = 0.75

// The prior-month-pace comparison (composeSpendingPaceHighlight) is only
// worth a sentence once the gap is at least this large — small swings are
// normal month to month and not worth flagging.
const SPENDING_PACE_ALERT_FRACTION = 0.15

// Comparing today's spend-to-date against last month's full total scaled by
// how far into the month we are is noisy in the first few days of a month
// (a single big grocery run on day 2 looks like a huge "spike"). Wait until
// at least this fraction of the month has elapsed before drawing a
// conclusion.
const MIN_MONTH_FRACTION_ELAPSED_FOR_PACE_CHECK = 0.1

/** "You're already deep into a budget" — the single expense category (if
 * any) that has used up the largest share of its monthly budget, once that
 * share is at or above BUDGET_PACE_ALERT_THRESHOLD. Built entirely from
 * `context.categories`, i.e. straight from spentByCategoryThisMonth and the
 * budgets the user set — never invents a number. Categories without a
 * budget are skipped (nothing to compare against). Returns null when no
 * category currently qualifies. */
export function composeBudgetPaceHighlight(context: FinancialContext): string | null {
  const candidates = context.categories
    .filter((c) => c.kind === 'expense' && c.budget && c.budget.limit > 0)
    .map((c) => {
      const progress = budgetProgress(c, context)
      if (!progress) return undefined
      return { name: c.name, ...progress, fraction: progress.spent / progress.limit }
    })
    .filter((c): c is NonNullable<typeof c> => c !== undefined && c.fraction >= BUDGET_PACE_ALERT_THRESHOLD)
    .sort((a, b) => b.fraction - a.fraction)

  const top = candidates[0]
  if (!top) return null

  const dayWord = top.daysLeft === 1 ? 'day' : 'days'
  if (top.fraction >= 1) {
    return `${top.name} is already over its ${formatMoney(top.limit)} budget this ${top.periodWord}, with ${top.daysLeft} ${dayWord} left.`
  }
  return `${top.name} is already ${pct(top.fraction)} through its ${formatMoney(top.limit)} budget, with ${top.daysLeft} ${dayWord} left this ${top.periodWord}.`
}

/** "Overall spending is running hot/cool vs last month" — compares this
 * month's expense total so far against what last month's expense total
 * would suggest for the same point in the month (last month's full total,
 * scaled down by how far through the current month we are). Built directly
 * on top of `buildMonthlySeries`'s output — pass in at least 2 months
 * (current + at least one prior). Returns null when there isn't a prior
 * month to compare against, it's too early in the month to trust the
 * comparison, or the gap isn't large enough to be worth a callout. */
export function composeSpendingPaceHighlight(series: MonthlyPoint[], today: Date = new Date()): string | null {
  if (series.length < 2) return null
  const current = series[series.length - 1]
  const prior = series[series.length - 2]
  if (prior.expense <= 0) return null

  const totalDaysThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const fractionElapsed = today.getDate() / totalDaysThisMonth
  if (fractionElapsed < MIN_MONTH_FRACTION_ELAPSED_FOR_PACE_CHECK) return null

  const expectedByNow = prior.expense * fractionElapsed
  if (expectedByNow <= 0) return null

  const diffFraction = (current.expense - expectedByNow) / expectedByNow
  if (Math.abs(diffFraction) < SPENDING_PACE_ALERT_FRACTION) return null

  const direction = diffFraction > 0 ? 'above' : 'below'
  return `Spending this month is running about ${pct(Math.abs(diffFraction))} ${direction} last month's pace at this point (${formatMoney(current.expense)} so far vs ${formatMoney(expectedByNow)} expected by now).`
}

/** Week-over-week analog of composeSpendingPaceHighlight — compares this
 * week's expense-so-far against what last week's total would suggest for
 * the same point in the week (Monday-start, so "how far elapsed" is just
 * ISO weekday / 7). Pass in at least 2 weeks (current + at least one
 * prior) from buildWeeklySeries. Same early-week noise guard and minimum-gap
 * threshold as the monthly version, reused as-is since both are small
 * fractions of a period. */
export function composeWeeklySpendingPaceHighlight(series: WeeklyPoint[], today: Date = new Date()): string | null {
  if (series.length < 2) return null
  const current = series[series.length - 1]
  const prior = series[series.length - 2]
  if (prior.expense <= 0) return null

  const jsDay = today.getDay()
  const isoDay = jsDay === 0 ? 7 : jsDay // 1 = Monday .. 7 = Sunday
  const fractionElapsed = isoDay / 7
  if (fractionElapsed < MIN_MONTH_FRACTION_ELAPSED_FOR_PACE_CHECK) return null

  const expectedByNow = prior.expense * fractionElapsed
  if (expectedByNow <= 0) return null

  const diffFraction = (current.expense - expectedByNow) / expectedByNow
  if (Math.abs(diffFraction) < SPENDING_PACE_ALERT_FRACTION) return null

  const direction = diffFraction > 0 ? 'above' : 'below'
  return `Spending this week is running about ${pct(Math.abs(diffFraction))} ${direction} last week's pace at this point (${formatMoney(current.expense)} so far vs ${formatMoney(expectedByNow)} expected by now).`
}

/** The single best personalized, data-grounded insight to surface — or null
 * when there's genuinely nothing meaningful to say yet (e.g. a brand-new
 * install with no budgets or history). Prefers the more specific,
 * actionable category-budget-pace insight; falls back to the coarser
 * overall-spending-pace comparison. Never fabricates a figure — every
 * number comes from `context` (itself built from real transactions/budgets)
 * or `series` (from buildMonthlySeries). */
export function composePersonalizedHighlight(
  context: FinancialContext,
  series: MonthlyPoint[],
  today: Date = new Date(),
): string | null {
  return composeBudgetPaceHighlight(context) ?? composeSpendingPaceHighlight(series, today)
}
