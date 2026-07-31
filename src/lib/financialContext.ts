import type { Account, Budget, Category, Transaction, Transfer } from '../db'
import { accountBalance, averageMonthlySpend, daysLeftInMonth, spentByCategoryThisMonth } from './finance'
import { currentMonthKey } from './dates'
import { formatMoney } from './format'
import {
  BUDGET_RULE_50_30_20,
  BUDGET_RULE_TOLERANCE,
  IMPULSE_COOLDOWN_AMOUNT,
  NEEDS_CATEGORIES,
  PURCHASE_CAUTION_FRACTION,
} from './financialKnowledge'

// A compact snapshot of "how am I doing financially right now" — computed
// once per question from real local data. Every answer function below reads
// only from this (plus the fixed rules in financialKnowledge.ts), so nothing
// is ever invented — it's either your own number or a well-known guideline.
export interface FinancialContext {
  monthKey: string
  daysLeftInMonth: number
  netWorth: number
  accounts: { name: string; balance: number }[]
  categories: {
    name: string
    kind: Category['kind']
    budget?: number
    spentThisMonth: number
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
    .map((c) => ({
      name: c.name,
      kind: c.kind,
      budget: budgets.find((b) => b.categoryId === c.id)?.monthlyLimit,
      spentThisMonth: spentByCategoryThisMonth(transactions, c.id, today),
      avgMonthlyHistorical: averageMonthlySpend(transactions, c.id, monthKey),
    }))

  return {
    monthKey,
    daysLeftInMonth: daysLeftInMonth(today),
    netWorth: accountRows.reduce((sum, a) => sum + a.balance, 0),
    accounts: accountRows,
    categories: categoryRows,
    incomeThisMonth: categoryRows.filter((c) => c.kind === 'income').reduce((sum, c) => sum + c.spentThisMonth, 0),
    expenseThisMonth: categoryRows.filter((c) => c.kind === 'expense').reduce((sum, c) => sum + c.spentThisMonth, 0),
  }
}

/** The always-available, fully offline answer — a deterministic template
 * filled in with real numbers from `context`. Never invents a figure. Used
 * directly when offline / no AI key configured, and as the guaranteed
 * fallback if the optional AI enhancement fails or times out. */
export function composeLocalAnswer(context: FinancialContext, categoryName?: string): string {
  if (categoryName) {
    const cat = context.categories.find((c) => c.name === categoryName)
    if (!cat) return `I don't have a "${categoryName}" category to check yet.`

    if (cat.budget !== undefined) {
      const remaining = cat.budget - cat.spentThisMonth
      if (remaining >= 0) {
        const perDay = remaining / context.daysLeftInMonth
        const dayWord = context.daysLeftInMonth === 1 ? 'day' : 'days'
        return `${cat.name}: ${formatMoney(remaining)} left of your ${formatMoney(cat.budget)} budget this month (spent ${formatMoney(cat.spentThisMonth)} so far) — about ${formatMoney(perDay)}/day for the next ${context.daysLeftInMonth} ${dayWord}.`
      }
      return `You're ${formatMoney(Math.abs(remaining))} over your ${cat.name} budget this month (spent ${formatMoney(cat.spentThisMonth)} of ${formatMoney(cat.budget)}).`
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
  const needsSpend = expenseCats.filter((c) => NEEDS_CATEGORIES.has(c.name)).reduce((s, c) => s + c.spentThisMonth, 0)
  const wantsSpend = expenseCats.filter((c) => !NEEDS_CATEGORIES.has(c.name)).reduce((s, c) => s + c.spentThisMonth, 0)
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
    const allowance = cat.budget ?? (cat.avgMonthlyHistorical > 0 ? cat.avgMonthlyHistorical : undefined)
    if (allowance !== undefined) {
      const remaining = allowance - cat.spentThisMonth
      if (amount > remaining) {
        return `That would put you ${formatMoney(amount - remaining)} over what's left in ${cat.name} this month (${formatMoney(Math.max(remaining, 0))} left of ${formatMoney(allowance)}) — I'd hold off or trim something else.${cooldownNote}`
      }
      if (amount > remaining * PURCHASE_CAUTION_FRACTION) {
        return `That's ${formatMoney(amount)} of the ${formatMoney(remaining)} you have left in ${cat.name} this month — doable, but it'll eat more than half of what's left.${cooldownNote}`
      }
      return `You have ${formatMoney(remaining)} left in ${cat.name} this month, so ${formatMoney(amount)} fits comfortably.${cooldownNote}`
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
