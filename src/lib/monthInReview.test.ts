import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Account, Budget, Category, Transaction, Transfer } from '../db'
import { buildMonthInReviewFallback, generateMonthInReview, type MonthInReviewInput } from './monthInReview'
import { formatMoney } from './format'

// July 15, 2026 — a 31-day month, so 17 days left (matches the fixture date
// already used in financialContext.test.ts for the same reasoning).
const TODAY = new Date(2026, 6, 15)

const accounts: Account[] = [
  { id: 1, name: 'GCash', type: 'checking', startingBalance: 0, createdAt: '' },
  { id: 2, name: 'Savings', type: 'savings', startingBalance: 0, createdAt: '' },
]

const categories: Category[] = [
  { id: 1, name: 'Salary', kind: 'income', color: '#0f0' },
  { id: 2, name: 'Groceries', kind: 'expense', color: '#f00' },
]

function tx(overrides: Partial<Transaction>): Transaction {
  return { id: Math.random(), accountId: 1, categoryId: 2, amount: 0, date: '2026-07-01', note: '', createdAt: '', ...overrides }
}

/** A scenario with clear, multi-signal history: a category riding right up
 * against its budget, a big jump in this month's spend vs. its own recent
 * average, and income logged so the 50/30/20 health check has something to
 * compare against — every composeXHighlight building block should have
 * something to say. */
function richInput(): MonthInReviewInput {
  const budgets: Budget[] = [{ id: 1, categoryId: 2, period: 'monthly', limit: 5000 }]
  const transactions: Transaction[] = [
    tx({ id: 1, amount: 2000, date: '2026-05-10' }), // Groceries, May
    tx({ id: 2, amount: 2000, date: '2026-06-10' }), // Groceries, June
    tx({ id: 3, categoryId: 1, amount: 20000, date: '2026-07-05' }), // Salary, this month
    tx({ id: 4, amount: 4500, date: '2026-07-10' }), // Groceries, this month — 90% of budget, >2x the 2000 historical average
  ]
  // 4000 actually transferred to Savings this month (20% of income) — real
  // saved money, not just unspent income assumed to be saved.
  const transfers: Transfer[] = [
    { id: 1, fromAccountId: 1, toAccountId: 2, amount: 4000, date: '2026-07-12', note: '', createdAt: '' },
  ]
  return { transactions, categories, budgets, accounts, transfers }
}

/** A brand-new install: no transactions, no budgets — nothing for
 * composeBudgetPaceHighlight, composeSpendingPaceHighlight, or
 * detectUnusualSpend to grab onto. Mirrors the "not enough history"
 * scenario composePersonalizedHighlight already handles in
 * financialContext.ts (returns null there; here composeBudgetHealthCheck's
 * own built-in "no income logged" sentence is the only thing left). */
function emptyInput(): MonthInReviewInput {
  return { transactions: [], categories, budgets: [], accounts, transfers: [] }
}

describe('buildMonthInReviewFallback', () => {
  it('bundles budget-pace, spending-pace, health-check, and unusual-spend signals into one recap when there is clear history', () => {
    const result = buildMonthInReviewFallback(richInput(), TODAY)

    // composeBudgetPaceHighlight: Groceries at 4500/5000 = 90%, over the 75% alert threshold.
    expect(result).toContain(`Groceries is already 90% through its ${formatMoney(5000)} budget, with 17 days left this month.`)
    // composeSpendingPaceHighlight: this month's pace vs last month's, scaled to today.
    expect(result).toContain("running about")
    expect(result).toContain('above')
    // composeBudgetHealthCheck: income was logged, so this is the 50/30/20 split summary, not the "no income" message.
    expect(result).toContain('looking healthy')
    // detectUnusualSpend: 4500 is more than double the 2000 historical average, with exactly 2 months of history (fallback-multiple method).
    expect(result).toContain(
      `Groceries is already more than double its usual pace this month: ${formatMoney(4500)} so far vs a typical ${formatMoney(2000)}/month.`,
    )
  })

  it('returns just the deterministic "no income logged" health-check sentence for a brand-new install with no history', () => {
    const result = buildMonthInReviewFallback(emptyInput(), TODAY)
    expect(result).toBe(
      "No income logged yet this month, so I can't check your budget split against the 50/30/20 guideline (50% needs, 30% wants, 20% savings) — log your payout first.",
    )
    expect(result).not.toContain('Groceries')
  })

  it('produces a much shorter result for a brand-new install than for a month with clear budget/spending signals', () => {
    const richLength = buildMonthInReviewFallback(richInput(), TODAY).length
    const emptyLength = buildMonthInReviewFallback(emptyInput(), TODAY).length
    expect(emptyLength).toBeLessThan(richLength)
  })

  it('never fabricates a category name that was not in the input', () => {
    const result = buildMonthInReviewFallback(richInput(), TODAY)
    expect(result).not.toContain('Rent') // not part of the fixture's categories at all
  })
})

describe('generateMonthInReview', () => {
  beforeEach(() => {
    // Defensive — detectNativeAi()/isLocalModelEnabled() should already
    // report false with nothing installed under vitest's node environment,
    // but clear these explicitly so this test never depends on ordering
    // relative to other test files in the same run.
    delete (globalThis as Record<string, unknown>).LanguageModel
    delete (globalThis as Record<string, unknown>).ai
    delete (globalThis as Record<string, unknown>).localStorage
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).LanguageModel
    delete (globalThis as Record<string, unknown>).ai
    delete (globalThis as Record<string, unknown>).localStorage
  })

  it('falls back to the deterministic template text (tier "template") when no native or local AI is available', async () => {
    const input = richInput()
    const result = await generateMonthInReview(input, TODAY)
    expect(result).toEqual({ text: buildMonthInReviewFallback(input, TODAY), tier: 'template' })
  })
})
