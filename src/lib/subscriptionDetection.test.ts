import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Category, RecurringBill, Transaction } from '../db'
import {
  detectSubscriptionCandidates,
  dismissSubscriptionCandidate,
  isSubscriptionCandidateDismissed,
} from './subscriptionDetection'

const netflix: Category = { id: 1, name: 'Subscriptions', kind: 'expense', color: '#a855f7' }
const groceries: Category = { id: 2, name: 'Groceries', kind: 'expense', color: '#f97316' }
const salary: Category = { id: 3, name: 'Salary', kind: 'income', color: '#22c55e' }
const categories = [netflix, groceries, salary]

const TODAY = new Date(2026, 6, 20) // July 20, 2026

function tx(overrides: Partial<Transaction>): Transaction {
  return { id: Math.random(), accountId: 1, categoryId: netflix.id, amount: 149, date: '2026-07-01', note: '', createdAt: '', ...overrides }
}

describe('detectSubscriptionCandidates', () => {
  it('flags a same-amount, same-category charge repeating roughly monthly', () => {
    const transactions = [
      tx({ date: '2026-05-15' }),
      tx({ date: '2026-06-14' }),
      tx({ date: '2026-07-15' }),
    ]
    const result = detectSubscriptionCandidates(transactions, categories, [], TODAY)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ categoryId: netflix.id, amount: 149, key: `${netflix.id}:149` })
    expect(result[0].occurrences).toEqual(['2026-05-15', '2026-06-14', '2026-07-15'])
  })

  it('requires at least 3 occurrences', () => {
    const transactions = [tx({ date: '2026-06-14' }), tx({ date: '2026-07-15' })]
    expect(detectSubscriptionCandidates(transactions, categories, [], TODAY)).toEqual([])
  })

  it('rejects a pattern with an irregular gap (not monthly)', () => {
    const transactions = [
      tx({ date: '2026-07-01' }),
      tx({ date: '2026-07-08' }), // a week later, not a month
      tx({ date: '2026-07-15' }),
    ]
    expect(detectSubscriptionCandidates(transactions, categories, [], TODAY)).toEqual([])
  })

  it('ignores income categories (e.g. a fixed monthly salary)', () => {
    const transactions = [
      tx({ categoryId: salary.id, amount: 20000, date: '2026-05-05' }),
      tx({ categoryId: salary.id, amount: 20000, date: '2026-06-05' }),
      tx({ categoryId: salary.id, amount: 20000, date: '2026-07-05' }),
    ]
    expect(detectSubscriptionCandidates(transactions, categories, [], TODAY)).toEqual([])
  })

  it('excludes a pattern already tracked by an active recurring bill of the same category/amount', () => {
    const transactions = [
      tx({ date: '2026-05-15' }),
      tx({ date: '2026-06-14' }),
      tx({ date: '2026-07-15' }),
    ]
    const bills: RecurringBill[] = [
      { id: 1, name: 'Netflix', amount: 149, frequency: 'monthly', dueDay: 15, accountId: 1, categoryId: netflix.id, active: true },
    ]
    expect(detectSubscriptionCandidates(transactions, categories, bills, TODAY)).toEqual([])
  })

  it('does not exclude a match against an inactive (deleted-in-spirit) bill', () => {
    const transactions = [
      tx({ date: '2026-05-15' }),
      tx({ date: '2026-06-14' }),
      tx({ date: '2026-07-15' }),
    ]
    const bills: RecurringBill[] = [
      { id: 1, name: 'Netflix', amount: 149, frequency: 'monthly', dueDay: 15, accountId: 1, categoryId: netflix.id, active: false },
    ]
    expect(detectSubscriptionCandidates(transactions, categories, bills, TODAY)).toHaveLength(1)
  })

  it('ignores a pattern that stopped recurring long ago', () => {
    const transactions = [
      tx({ date: '2025-11-15' }),
      tx({ date: '2025-12-15' }),
      tx({ date: '2026-01-15' }), // last seen ~6 months before TODAY
    ]
    expect(detectSubscriptionCandidates(transactions, categories, [], TODAY)).toEqual([])
  })
})

describe('subscription candidate dismissal', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    ;(globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v))
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
    }
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage
  })

  it('is not dismissed by default', () => {
    expect(isSubscriptionCandidateDismissed('1:149')).toBe(false)
  })

  it('is dismissed after dismissSubscriptionCandidate is called for that key', () => {
    dismissSubscriptionCandidate('1:149')
    expect(isSubscriptionCandidateDismissed('1:149')).toBe(true)
    expect(isSubscriptionCandidateDismissed('2:200')).toBe(false)
  })
})
