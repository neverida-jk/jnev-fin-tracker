import { describe, expect, it } from 'vitest'
import type { Account, Category, Transaction } from '../db'
import { buildTransactionsCsv } from './csvExport'

const gcash: Account = { id: 1, name: 'GCash', type: 'checking', startingBalance: 0, createdAt: '' }
const groceries: Category = { id: 1, name: 'Groceries', kind: 'expense', color: '#f97316' }
const salary: Category = { id: 2, name: 'Salary', kind: 'income', color: '#22c55e' }
const accountsById = new Map([[gcash.id, gcash]])
const categoriesById = new Map([
  [groceries.id, groceries],
  [salary.id, salary],
])

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    accountId: gcash.id,
    categoryId: groceries.id,
    amount: 100,
    date: '2026-07-15',
    note: '',
    createdAt: new Date(2026, 6, 15, 9, 5).toISOString(),
    ...overrides,
  }
}

describe('buildTransactionsCsv', () => {
  it('renders a header row followed by one row per transaction', () => {
    const csv = buildTransactionsCsv([tx()], accountsById, categoriesById)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Date,Time,Account,Category,Type,Amount,Note')
    expect(lines[1]).toBe('2026-07-15,9:05 AM,GCash,Groceries,expense,100.00,')
    expect(lines).toHaveLength(2)
  })

  it('sorts oldest first by date, then by time within the same date', () => {
    const csv = buildTransactionsCsv(
      [
        tx({ id: 1, date: '2026-07-16', createdAt: new Date(2026, 6, 16, 10, 0).toISOString() }),
        tx({ id: 2, date: '2026-07-15', createdAt: new Date(2026, 6, 15, 18, 0).toISOString() }),
        tx({ id: 3, date: '2026-07-15', createdAt: new Date(2026, 6, 15, 8, 0).toISOString() }),
      ],
      accountsById,
      categoriesById,
    )
    const dataLines = csv.split('\r\n').slice(1)
    expect(dataLines.map((l) => l.split(',')[1])).toEqual(['8:00 AM', '6:00 PM', '10:00 AM'])
  })

  it('quotes a note containing a comma', () => {
    const csv = buildTransactionsCsv([tx({ note: 'weekly, groceries' })], accountsById, categoriesById)
    expect(csv).toContain('"weekly, groceries"')
  })

  it('falls back to a placeholder for an unknown account or category', () => {
    const csv = buildTransactionsCsv([tx({ accountId: 999, categoryId: 999 })], accountsById, categoriesById)
    expect(csv).toContain('Unknown account')
    expect(csv).toContain('Unknown category')
  })

  it('produces just the header row when there are no transactions', () => {
    expect(buildTransactionsCsv([], accountsById, categoriesById)).toBe('Date,Time,Account,Category,Type,Amount,Note')
  })
})
