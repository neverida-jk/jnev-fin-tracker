import type { Account, Budget, Category, Transaction, Transfer } from '../db'
import {
  buildFinancialContext,
  composeBudgetHealthCheck,
  composeBudgetPaceHighlight,
  composeSpendingPaceHighlight,
  composeWeeklySpendingPaceHighlight,
} from './financialContext'
import { detectUnusualSpend } from './anomalyDetection'
import { buildMonthlySeries, buildWeeklySeries } from './finance'
import { currentMonthKey } from './dates'
import { generateNarrative, type AiTier } from './aiEngine'

export interface MonthInReviewInput {
  transactions: Transaction[]
  categories: Category[]
  budgets: Budget[]
  accounts: Account[]
  transfers: Transfer[]
}

// How many months of history to pull for the pace-vs-last-month comparison
// (composeSpendingPaceHighlight needs at least the current + one prior
// month; 6 gives it a bit of headroom without costing much to compute).
const MONTHLY_SERIES_MONTHS_BACK = 6

/** The deterministic, always-available "month in review" paragraph — Tier 3
 * in the AI tier chain, and the guaranteed fallback for generateMonthInReview
 * below. Built entirely by bundling the existing deterministic building
 * blocks (buildFinancialContext, composeBudgetPaceHighlight,
 * composeSpendingPaceHighlight, composeBudgetHealthCheck,
 * detectUnusualSpend) — every sentence is either a caller's own number or a
 * well-known guideline, nothing here is invented. Functions that return
 * null (no qualifying highlight this month) are skipped outright rather
 * than papered over with a placeholder sentence. Has zero dependency on
 * aiEngine.ts, so it works even if that module's browser APIs are entirely
 * unavailable. */
export function buildMonthInReviewFallback(input: MonthInReviewInput, today: Date = new Date()): string {
  const { transactions, categories, budgets, accounts, transfers } = input
  const categoriesById = new Map(categories.map((c) => [c.id, c]))

  const context = buildFinancialContext(accounts, categories, transactions, transfers, budgets, today)
  const series = buildMonthlySeries(accounts, transactions, transfers, categoriesById, MONTHLY_SERIES_MONTHS_BACK, today)

  const sentences: string[] = []

  const budgetPace = composeBudgetPaceHighlight(context)
  if (budgetPace) sentences.push(budgetPace)

  const spendingPace = composeSpendingPaceHighlight(series, today)
  if (spendingPace) sentences.push(spendingPace)

  // composeBudgetHealthCheck always returns a string (it has its own
  // "no income logged yet" message rather than returning null), so this
  // guarantees `sentences` is never empty.
  sentences.push(composeBudgetHealthCheck(context))

  for (const unusual of detectUnusualSpend(transactions, categories, today)) {
    sentences.push(unusual.message)
  }

  return sentences.join(' ')
}

/** Turns the deterministic fallback paragraph above into a prompt for the
 * optional AI narrative layer — handing the model the exact facts already
 * computed (and only those facts), so it's asked to rephrase/warm up
 * existing numbers rather than invent anything new. */
function buildMonthInReviewPrompt(fallbackText: string, monthKey: string): string {
  return [
    `You are a friendly personal finance assistant writing a short "month in review" recap for ${monthKey}.`,
    'Rewrite the facts below as a warm, natural 2-4 sentence recap.',
    'Only use the numbers and facts already given — do not invent any new figures, categories, or events, and do not add advice beyond what the facts already imply.',
    '',
    'Facts:',
    fallbackText,
  ].join('\n')
}

/** Bundles the deterministic building blocks into one narrative request:
 * builds the guaranteed Tier-3 fallback text, builds a prompt carrying the
 * same underlying facts, and hands both to generateNarrative() so the
 * caller gets native AI / local-model / template output — in that order of
 * preference — with the deterministic paragraph always available if the
 * AI tiers are unavailable or fail. */
export async function generateMonthInReview(
  input: MonthInReviewInput,
  today: Date = new Date(),
): Promise<{ text: string; tier: AiTier }> {
  const fallbackText = buildMonthInReviewFallback(input, today)
  const prompt = buildMonthInReviewPrompt(fallbackText, currentMonthKey(today))
  return generateNarrative(prompt, fallbackText)
}

// How many weeks of history to pull for the week-over-week pace comparison.
const WEEKLY_SERIES_WEEKS_BACK = 8

// Shown when there is genuinely nothing to flag yet this week — unlike
// buildMonthInReviewFallback, composeBudgetHealthCheck (the one building
// block guaranteed to always return a sentence) is deliberately not reused
// here, since a needs/wants/savings-vs-income check is a monthly-budgeting
// convention that does not translate cleanly to a single week. Anomaly
// detection is also month-scoped (it compares against monthly historical
// averages) but is still meaningful to surface regardless of which review
// period the user is looking at, so it's included in both.
const NOTHING_TO_FLAG_THIS_WEEK = 'Nothing notable to flag this week yet — keep logging transactions and check back.'

/** Week-mode analog of buildMonthInReviewFallback — budget pace (already
 * period-agnostic per-budget, see financialContext.ts's budgetProgress) plus
 * the week-over-week spending pace and any anomalies. Always returns a
 * non-empty string, same guarantee as the month version, just via an
 * explicit fallback sentence instead of composeBudgetHealthCheck. */
export function buildWeekInReviewFallback(input: MonthInReviewInput, today: Date = new Date()): string {
  const { transactions, categories, budgets, accounts, transfers } = input
  const categoriesById = new Map(categories.map((c) => [c.id, c]))

  const context = buildFinancialContext(accounts, categories, transactions, transfers, budgets, today)
  const series = buildWeeklySeries(accounts, transactions, categoriesById, WEEKLY_SERIES_WEEKS_BACK, today)

  const sentences: string[] = []

  const budgetPace = composeBudgetPaceHighlight(context)
  if (budgetPace) sentences.push(budgetPace)

  const spendingPace = composeWeeklySpendingPaceHighlight(series, today)
  if (spendingPace) sentences.push(spendingPace)

  for (const unusual of detectUnusualSpend(transactions, categories, today)) {
    sentences.push(unusual.message)
  }

  return sentences.length > 0 ? sentences.join(' ') : NOTHING_TO_FLAG_THIS_WEEK
}

function buildWeekInReviewPrompt(fallbackText: string): string {
  return [
    'You are a friendly personal finance assistant writing a short "week in review" recap.',
    'Rewrite the facts below as a warm, natural 2-4 sentence recap.',
    'Only use the numbers and facts already given — do not invent any new figures, categories, or events, and do not add advice beyond what the facts already imply.',
    '',
    'Facts:',
    fallbackText,
  ].join('\n')
}

/** Week-mode analog of generateMonthInReview — same native/local-model/
 * template tier chain, just built from buildWeekInReviewFallback. */
export async function generateWeekInReview(
  input: MonthInReviewInput,
  today: Date = new Date(),
): Promise<{ text: string; tier: AiTier }> {
  const fallbackText = buildWeekInReviewFallback(input, today)
  const prompt = buildWeekInReviewPrompt(fallbackText)
  return generateNarrative(prompt, fallbackText)
}
