import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Category, Transaction } from '../db'
import { computeBudgetRecommendationFallback, recommendBudget } from './budgetRecommendation'
import { formatMoney } from './format'

// This suite never touches the real AI layer: aiEngine's generateNarrative is
// mocked outright (below), so no test here can ever reach @xenova/transformers,
// a native browser AI global, or the network — mirroring the hermetic approach
// aiEngine.test.ts uses for the transformers package itself, just one level up
// the call chain.
const { generateNarrativeMock } = vi.hoisted(() => ({ generateNarrativeMock: vi.fn() }))
vi.mock('./aiEngine', () => ({
  generateNarrative: generateNarrativeMock,
}))

afterEach(() => {
  generateNarrativeMock.mockReset()
})

const groceries: Category = { id: 1, name: 'Groceries', kind: 'expense', color: '#f97316' } // a NEEDS_CATEGORIES member
const dining: Category = { id: 2, name: 'Dining', kind: 'expense', color: '#ec4899' } // not in NEEDS_CATEGORIES -> "wants"

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    accountId: 1,
    categoryId: groceries.id,
    amount: 100,
    date: '2026-06-15',
    note: '',
    createdAt: '',
    ...overrides,
  }
}

describe('computeBudgetRecommendationFallback', () => {
  it('with history: buffers the average by 10%, rounds to the nearest 100 at/above the ₱1,000 threshold, and states the real average', () => {
    // avg of two completed months (900, 1000) = 950; *1.1 = 1045 -> rounds to
    // nearest 100 since 1045 >= 1000 -> 1000. (If the increment branches were
    // swapped, nearest-50 would give 1050 instead.)
    const transactions = [
      tx({ date: '2026-05-15', amount: 900 }),
      tx({ date: '2026-06-15', amount: 1000 }),
    ]
    const result = computeBudgetRecommendationFallback(groceries, transactions, new Date(2026, 6, 10))
    expect(result.suggestedAmount).toBe(1000)
    expect(result.reasonFallback).toContain('Groceries')
    expect(result.reasonFallback).toContain(formatMoney(950))
    expect(result.reasonFallback).toContain(formatMoney(1000))
  })

  it('with history: rounds to the nearest 50 below the ₱1,000 threshold', () => {
    // avg of two completed months (100, 160) = 130; *1.1 = 143 -> rounds to
    // nearest 50 since 143 < 1000 -> 150. (Nearest-100 would give 100 instead,
    // so this distinguishes the two rounding branches from the case above.)
    const transactions = [
      tx({ date: '2026-05-15', amount: 100 }),
      tx({ date: '2026-06-15', amount: 160 }),
    ]
    const result = computeBudgetRecommendationFallback(groceries, transactions, new Date(2026, 6, 10))
    expect(result.suggestedAmount).toBe(150)
  })

  it('with history: floors a tiny positive average to one increment instead of rounding down to 0', () => {
    // avg of two completed months (10, 10) = 10; *1.1 = 11 -> naive nearest-50
    // rounding would give 0, which must be guarded up to 50 instead, since
    // real spending history should never yield "no suggestion".
    const transactions = [
      tx({ date: '2026-05-15', amount: 10 }),
      tx({ date: '2026-06-15', amount: 10 }),
    ]
    const result = computeBudgetRecommendationFallback(groceries, transactions, new Date(2026, 6, 10))
    expect(result.suggestedAmount).toBe(50)
    expect(result.suggestedAmount).not.toBe(0)
  })

  it('with history: excludes the current (in-progress) month from the average', () => {
    const transactions = [
      tx({ date: '2026-05-15', amount: 900 }),
      tx({ date: '2026-06-15', amount: 1000 }),
      tx({ date: '2026-07-15', amount: 999999 }), // current month, must be excluded
    ]
    const result = computeBudgetRecommendationFallback(groceries, transactions, new Date(2026, 6, 20))
    expect(result.suggestedAmount).toBe(1000)
  })

  it('no history: returns a null amount and never fabricates a peso figure', () => {
    const result = computeBudgetRecommendationFallback(groceries, [], new Date(2026, 6, 10))
    expect(result.suggestedAmount).toBeNull()
    expect(result.reasonFallback).not.toContain('₱')
  })

  it('no history: needs category (e.g. Groceries) references the 50% needs guideline', () => {
    const result = computeBudgetRecommendationFallback(groceries, [], new Date(2026, 6, 10))
    expect(result.suggestedAmount).toBeNull()
    expect(result.reasonFallback).toContain('50%')
    expect(result.reasonFallback).toContain('needs')
  })

  it('no history: a category outside NEEDS_CATEGORIES (Dining) references the 30% wants guideline, not needs', () => {
    const result = computeBudgetRecommendationFallback(dining, [], new Date(2026, 6, 10))
    expect(result.suggestedAmount).toBeNull()
    expect(result.reasonFallback).toContain('30%')
    expect(result.reasonFallback).toContain('wants')
    expect(result.reasonFallback).not.toContain('50%')
  })

  it('no history: only counts transactions for the requested category', () => {
    const transactions = [tx({ categoryId: dining.id, date: '2026-05-15', amount: 5000 })]
    const result = computeBudgetRecommendationFallback(groceries, transactions, new Date(2026, 6, 10))
    expect(result.suggestedAmount).toBeNull()
  })
})

describe('recommendBudget', () => {
  it('falls back to the exact deterministic reasonFallback and tier "template" when no AI is available', async () => {
    generateNarrativeMock.mockImplementation(async (_prompt: string, fallbackText: string) => ({
      text: fallbackText,
      tier: 'template',
    }))

    const transactions = [
      tx({ date: '2026-05-15', amount: 900 }),
      tx({ date: '2026-06-15', amount: 1000 }),
    ]
    const fallback = computeBudgetRecommendationFallback(groceries, transactions, new Date(2026, 6, 10))
    const result = await recommendBudget(groceries, transactions, new Date(2026, 6, 10))

    expect(result.tier).toBe('template')
    expect(result.reason).toBe(fallback.reasonFallback)
    expect(result.suggestedAmount).toBe(fallback.suggestedAmount)
    expect(generateNarrativeMock).toHaveBeenCalledTimes(1)
    expect(generateNarrativeMock).toHaveBeenCalledWith(expect.any(String), fallback.reasonFallback)
  })

  it('never alters the deterministic suggestedAmount even when a mocked AI tier rephrases (and could have invented) a number', async () => {
    // Simulate an AI tier that returns totally different prose containing a
    // different (fabricated) number in the text — recommendBudget must still
    // return the original deterministic suggestedAmount untouched, since the
    // amount is computed once via computeBudgetRecommendationFallback and the
    // AI's output text is never inspected as a source of truth for it.
    generateNarrativeMock.mockResolvedValue({
      text: 'You should budget around ₱99,999 for this, trust me!',
      tier: 'native',
    })

    const transactions = [
      tx({ date: '2026-05-15', amount: 900 }),
      tx({ date: '2026-06-15', amount: 1000 }),
    ]
    const fallback = computeBudgetRecommendationFallback(groceries, transactions, new Date(2026, 6, 10))
    const result = await recommendBudget(groceries, transactions, new Date(2026, 6, 10))

    expect(result.suggestedAmount).toBe(fallback.suggestedAmount)
    expect(result.suggestedAmount).not.toBeNull()
    expect(result.tier).toBe('native')
    expect(result.reason).toBe('You should budget around ₱99,999 for this, trust me!')
  })

  it('keeps suggestedAmount null (never invents one) in the no-history case even when an AI tier responds', async () => {
    generateNarrativeMock.mockResolvedValue({
      text: 'Try budgeting ₱500 for this to start.',
      tier: 'local-model',
    })

    const result = await recommendBudget(groceries, [], new Date(2026, 6, 10))

    expect(result.suggestedAmount).toBeNull()
    expect(result.tier).toBe('local-model')
  })

  it('builds the prompt from the category name and passes the fallback reason through unmodified', async () => {
    generateNarrativeMock.mockImplementation(async (_prompt: string, fallbackText: string) => ({
      text: fallbackText,
      tier: 'template',
    }))

    await recommendBudget(dining, [], new Date(2026, 6, 10))

    const [prompt, fallbackArg] = generateNarrativeMock.mock.calls[0]
    expect(prompt).toContain('Dining')
    expect(prompt.toLowerCase()).toContain('do not invent')
    expect(fallbackArg).toContain('Dining')
  })
})
