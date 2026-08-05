import { describe, expect, it } from 'vitest'
import type { Category, Transaction } from '../db'
import { detectUnusualSpend } from './anomalyDetection'
import { formatMoney } from './format'

let nextTxId = 1
function tx(categoryId: number, amount: number, date: string): Transaction {
  return { id: nextTxId++, accountId: 1, categoryId, amount, date, note: '', createdAt: '' }
}

const REFERENCE_DATE = new Date(2026, 7, 10) // August 10, 2026 — current, in-progress month

describe('detectUnusualSpend', () => {
  it('flags a category with a clear spending spike against 3 months of stable prior history', () => {
    const categories: Category[] = [{ id: 1, name: 'Dining', kind: 'expense', color: '#ec4899' }]
    const transactions: Transaction[] = [
      tx(1, 1000, '2026-05-15'),
      tx(1, 1050, '2026-06-15'),
      tx(1, 950, '2026-07-15'),
      tx(1, 5000, '2026-08-05'), // current month — way above the ~1000 mean
    ]

    const result = detectUnusualSpend(transactions, categories, REFERENCE_DATE)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      categoryId: 1,
      categoryName: 'Dining',
      spentThisMonth: 5000,
      typicalMonthlySpend: 1000,
      monthsOfHistory: 3,
      method: 'stddev',
    })
    expect(result[0].message).toBe(
      `Dining is unusually high this month: ${formatMoney(5000)} so far vs a typical ${formatMoney(1000)}/month.`,
    )
  })

  it('does not flag a category with fewer than 2 completed months of history', () => {
    const categories: Category[] = [{ id: 2, name: 'Transport', kind: 'expense', color: '#3b82f6' }]
    const transactions: Transaction[] = [
      tx(2, 1000, '2026-07-10'), // only one completed prior month
      tx(2, 5000, '2026-08-05'), // would be a huge spike if it counted
    ]

    expect(detectUnusualSpend(transactions, categories, REFERENCE_DATE)).toEqual([])
  })

  it('does not flag a category whose current spend is within normal variance (stddev path)', () => {
    const categories: Category[] = [{ id: 3, name: 'Dining', kind: 'expense', color: '#ec4899' }]
    const transactions: Transaction[] = [
      tx(3, 1000, '2026-05-15'),
      tx(3, 1050, '2026-06-15'),
      tx(3, 950, '2026-07-15'),
      tx(3, 1030, '2026-08-05'), // close to the ~1000 mean, well under 1.75 sd
    ]

    expect(detectUnusualSpend(transactions, categories, REFERENCE_DATE)).toEqual([])
  })

  it('does not flag a category with exactly 2 months of history when spend is under the 2x fallback multiple', () => {
    const categories: Category[] = [{ id: 4, name: 'Utilities', kind: 'expense', color: '#eab308' }]
    const transactions: Transaction[] = [
      tx(4, 1000, '2026-06-10'),
      tx(4, 1200, '2026-07-10'), // mean = 1100
      tx(4, 1500, '2026-08-05'), // under 2 * 1100 = 2200
    ]

    expect(detectUnusualSpend(transactions, categories, REFERENCE_DATE)).toEqual([])
  })

  it('flags a category with exactly 2 months of history using the fallback-multiple heuristic once spend exceeds 2x the average', () => {
    const categories: Category[] = [{ id: 5, name: 'Subscriptions', kind: 'expense', color: '#a855f7' }]
    const transactions: Transaction[] = [
      tx(5, 500, '2026-06-10'),
      tx(5, 500, '2026-07-10'), // mean = 500
      tx(5, 1200, '2026-08-05'), // > 2 * 500 = 1000
    ]

    const result = detectUnusualSpend(transactions, categories, REFERENCE_DATE)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      categoryId: 5,
      method: 'fallback-multiple',
      typicalMonthlySpend: 500,
      spentThisMonth: 1200,
      monthsOfHistory: 2,
    })
  })

  it('never flags income categories, regardless of how large the spike looks', () => {
    const categories: Category[] = [{ id: 6, name: 'Salary', kind: 'income', color: '#22c55e' }]
    const transactions: Transaction[] = [
      tx(6, 20000, '2026-05-15'),
      tx(6, 20000, '2026-06-15'),
      tx(6, 20000, '2026-07-15'),
      tx(6, 100000, '2026-08-05'),
    ]

    expect(detectUnusualSpend(transactions, categories, REFERENCE_DATE)).toEqual([])
  })

  it('never flags system categories, regardless of how large the spike looks', () => {
    const categories: Category[] = [
      { id: 7, name: 'Balance Adjustment', kind: 'expense', color: '#94a3b8', system: true },
    ]
    const transactions: Transaction[] = [
      tx(7, 100, '2026-05-15'),
      tx(7, 100, '2026-06-15'),
      tx(7, 100, '2026-07-15'),
      tx(7, 10000, '2026-08-05'),
    ]

    expect(detectUnusualSpend(transactions, categories, REFERENCE_DATE)).toEqual([])
  })

  it('does not flag a category with zero spend this month even with a large prior spread', () => {
    const categories: Category[] = [{ id: 8, name: 'Travel', kind: 'expense', color: '#f97316' }]
    const transactions: Transaction[] = [
      tx(8, 1000, '2026-05-15'),
      tx(8, 3000, '2026-06-15'),
      tx(8, 500, '2026-07-15'),
      // no transaction at all in the current month
    ]

    expect(detectUnusualSpend(transactions, categories, REFERENCE_DATE)).toEqual([])
  })

  it('returns at most 2 results, ranked by how far over typical pace each category is', () => {
    const categories: Category[] = [
      { id: 9, name: 'Dining', kind: 'expense', color: '#ec4899' },
      { id: 10, name: 'Transport', kind: 'expense', color: '#3b82f6' },
      { id: 11, name: 'Utilities', kind: 'expense', color: '#eab308' },
    ]
    const transactions: Transaction[] = [
      // Dining: mean 1000, current 3000 -> 3x pace
      tx(9, 1000, '2026-06-10'),
      tx(9, 1000, '2026-07-10'),
      tx(9, 3000, '2026-08-05'),
      // Transport: mean 1000, current 6000 -> 6x pace (should rank first)
      tx(10, 1000, '2026-06-10'),
      tx(10, 1000, '2026-07-10'),
      tx(10, 6000, '2026-08-05'),
      // Utilities: mean 1000, current 4000 -> 4x pace (should rank second)
      tx(11, 1000, '2026-06-10'),
      tx(11, 1000, '2026-07-10'),
      tx(11, 4000, '2026-08-05'),
    ]

    const result = detectUnusualSpend(transactions, categories, REFERENCE_DATE)
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.categoryName)).toEqual(['Transport', 'Utilities'])
  })

  it('returns an empty array when there are no categories or transactions at all', () => {
    expect(detectUnusualSpend([], [], REFERENCE_DATE)).toEqual([])
  })
})
