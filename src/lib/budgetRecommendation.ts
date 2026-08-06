import type { Category, Transaction } from '../db'
import { averageMonthlySpend } from './finance'
import { currentMonthKey } from './dates'
import { formatMoney } from './format'
import { BUDGET_RULE_50_30_20, NEEDS_CATEGORIES } from './financialKnowledge'
import { generateNarrative, type AiTier } from './aiEngine'

export interface BudgetRecommendation {
  suggestedAmount: number | null
  reasonFallback: string
}

// How much headroom to add on top of the plain historical average so the
// suggested limit isn't a razor's-edge number that gets blown past the
// moment spending is merely typical.
const HISTORY_BUFFER_MULTIPLIER = 1.1

// Below this amount, round to the nearest 50 (fine enough to still feel
// "clean" at smaller magnitudes); at or above it, round to the nearest 100
// (finer increments would just be false precision on a bigger number).
const CLEAN_ROUNDING_THRESHOLD = 1000
const CLEAN_ROUNDING_SMALL_INCREMENT = 50
const CLEAN_ROUNDING_LARGE_INCREMENT = 100

/** Rounds a buffered average to a "clean", friendly number — nearest 50 under
 * ₱1,000, nearest 100 at or above it. Guards against rounding a genuinely
 * positive amount down to 0 (e.g. a ₱10 average), since that would silently
 * turn real spending history into "no suggestion". */
function roundToCleanAmount(amount: number): number {
  const increment = amount < CLEAN_ROUNDING_THRESHOLD ? CLEAN_ROUNDING_SMALL_INCREMENT : CLEAN_ROUNDING_LARGE_INCREMENT
  const rounded = Math.round(amount / increment) * increment
  return rounded > 0 ? rounded : increment
}

/** The deterministic, always-available Tier-3 recommendation — the only
 * place the suggested NUMBER is ever computed. Never fabricates a figure: if
 * there's no real spending history for this category, suggestedAmount is
 * null rather than a guess, matching the "never invent a number" convention
 * used throughout financialContext.ts. AI (see recommendBudget below) is
 * only ever allowed to rephrase reasonFallback — it never sees or touches
 * suggestedAmount. */
export function computeBudgetRecommendationFallback(
  category: Category,
  transactions: Transaction[],
  today: Date = new Date(),
): BudgetRecommendation {
  const avg = averageMonthlySpend(transactions, category.id, currentMonthKey(today))

  if (avg > 0) {
    const suggestedAmount = roundToCleanAmount(avg * HISTORY_BUFFER_MULTIPLIER)
    return {
      suggestedAmount,
      reasonFallback: `Based on your average of ${formatMoney(avg)}/month spent on ${category.name}, we suggest ${formatMoney(suggestedAmount)} — a bit above your average so a typical month doesn't put you over.`,
    }
  }

  const isNeeds = NEEDS_CATEGORIES.has(category.name)
  const fractionPct = Math.round((isNeeds ? BUDGET_RULE_50_30_20.needs : BUDGET_RULE_50_30_20.wants) * 100)
  const kindLabel = isNeeds ? 'needs' : 'wants'
  return {
    suggestedAmount: null,
    reasonFallback: `No spending history yet for ${category.name}, so we can't suggest a specific amount. As a general guideline, ${kindLabel} categories like this are typically kept to around ${fractionPct}% of your income combined — log a few transactions here and we'll suggest a real number.`,
  }
}

/** Turns the deterministic fallback reason into a prompt for the optional AI
 * narrative layer — explicitly instructed to only rephrase, never invent or
 * change any numbers, following the same pattern as monthInReview.ts's
 * buildMonthInReviewPrompt. */
function buildBudgetRecommendationPrompt(category: Category, reasonFallback: string): string {
  return [
    `You are a friendly personal finance assistant explaining a suggested monthly budget for the "${category.name}" category.`,
    'Rewrite the explanation below in a warmer, more natural 1-2 sentences.',
    'Do not invent or change any numbers, amounts, or percentages — only rephrase the wording. Use only the facts already given.',
    '',
    'Explanation:',
    reasonFallback,
  ].join('\n')
}

/** Bundles the deterministic Tier-3 recommendation with the optional AI
 * narrative layer: computeBudgetRecommendationFallback() is the sole source
 * of suggestedAmount, and that number is returned unchanged here regardless
 * of what generateNarrative() (native / local-model / template, in that
 * order of preference) does with the reason text — the AI is only ever
 * asked to rephrase reasonFallback, never to produce or alter the amount. */
export async function recommendBudget(
  category: Category,
  transactions: Transaction[],
  today: Date = new Date(),
): Promise<{ suggestedAmount: number | null; reason: string; tier: AiTier }> {
  const { suggestedAmount, reasonFallback } = computeBudgetRecommendationFallback(category, transactions, today)
  const prompt = buildBudgetRecommendationPrompt(category, reasonFallback)
  const { text, tier } = await generateNarrative(prompt, reasonFallback)
  return { suggestedAmount, reason: text, tier }
}
