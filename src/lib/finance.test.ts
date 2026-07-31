import { describe, expect, it } from 'vitest'
import type { Account, Category, Transaction, Transfer } from '../db'
import { accountBalance, averageMonthlySpend, daysLeftInMonth, netWorth, signedAmount, spentByCategoryThisMonth } from './finance'

const income: Category = { id: 1, name: 'Salary', kind: 'income', color: '#0f0' }
const expense: Category = { id: 2, name: 'Groceries', kind: 'expense', color: '#f00' }
const categoriesById = new Map<number, Category>([
  [income.id, income],
  [expense.id, expense],
])

const gcash: Account = { id: 1, name: 'GCash', type: 'checking', startingBalance: 1000, createdAt: '' }
const savings: Account = { id: 2, name: 'Savings', type: 'savings', startingBalance: 0, createdAt: '' }

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return { id: 1, accountId: gcash.id, categoryId: expense.id, amount: 100, date: '2026-07-15', note: '', createdAt: '', ...overrides }
}

function transfer(overrides: Partial<Transfer> = {}): Transfer {
  return { id: 1, fromAccountId: gcash.id, toAccountId: savings.id, amount: 100, date: '2026-07-15', note: '', createdAt: '', ...overrides }
}

describe('signedAmount', () => {
  it('keeps income positive and flips expense to negative', () => {
    expect(signedAmount(100, 'income')).toBe(100)
    expect(signedAmount(100, 'expense')).toBe(-100)
  })
})

describe('accountBalance', () => {
  it('adds starting balance, income, subtracts expenses, and applies transfers', () => {
    const transactions = [
      tx({ id: 1, categoryId: expense.id, amount: 200 }),
      tx({ id: 2, categoryId: income.id, amount: 500 }),
    ]
    const transfers = [transfer({ amount: 50, fromAccountId: gcash.id, toAccountId: savings.id })]
    // 1000 (starting) - 200 (expense) + 500 (income) - 50 (transfer out) = 1250
    expect(accountBalance(gcash, transactions, transfers, categoriesById)).toBe(1250)
  })

  it('ignores transactions for other accounts', () => {
    const transactions = [tx({ accountId: savings.id, amount: 999 })]
    expect(accountBalance(gcash, transactions, [], categoriesById)).toBe(1000)
  })

  it('credits the destination and debits the source of a transfer', () => {
    const transfers = [transfer({ amount: 300 })]
    expect(accountBalance(gcash, [], transfers, categoriesById)).toBe(700)
    expect(accountBalance(savings, [], transfers, categoriesById)).toBe(300)
  })

  it('skips a transaction whose category no longer resolves (deleted category)', () => {
    // categoryId 999 isn't in categoriesById — simulates a category that was
    // deleted after the transaction referencing it was created.
    const transactions = [tx({ categoryId: 999, amount: 5000 })]
    expect(accountBalance(gcash, transactions, [], categoriesById)).toBe(1000)
  })
})

describe('netWorth', () => {
  it('sums balances across all accounts', () => {
    const transactions = [tx({ accountId: gcash.id, categoryId: income.id, amount: 500 })]
    const transfers = [transfer({ amount: 200 })]
    // gcash: 1000 + 500 - 200 = 1300; savings: 0 + 200 = 200
    expect(netWorth([gcash, savings], transactions, transfers, categoriesById)).toBe(1500)
  })

  it('is unaffected by transactions whose category no longer resolves', () => {
    const transactions = [tx({ accountId: gcash.id, categoryId: 999, amount: 5000 })]
    expect(netWorth([gcash, savings], transactions, [], categoriesById)).toBe(1000)
  })
})

describe('spentByCategoryThisMonth', () => {
  it('sums only the given category and month', () => {
    const transactions = [
      tx({ categoryId: expense.id, date: '2026-07-01', amount: 100 }),
      tx({ categoryId: expense.id, date: '2026-07-31', amount: 50 }),
      tx({ categoryId: expense.id, date: '2026-06-30', amount: 999 }), // different month
      tx({ categoryId: income.id, date: '2026-07-15', amount: 999 }), // different category
    ]
    expect(spentByCategoryThisMonth(transactions, expense.id, new Date(2026, 6, 20))).toBe(150)
  })

  it('returns 0 when there is no matching spend', () => {
    expect(spentByCategoryThisMonth([], expense.id, new Date(2026, 6, 20))).toBe(0)
  })
})

describe('averageMonthlySpend', () => {
  it('averages completed months and excludes the current month', () => {
    const transactions = [
      tx({ categoryId: expense.id, date: '2026-05-15', amount: 100 }),
      tx({ categoryId: expense.id, date: '2026-06-15', amount: 300 }),
      tx({ categoryId: expense.id, date: '2026-07-15', amount: 99999 }), // current month, excluded
    ]
    // (100 + 300) / 2 = 200
    expect(averageMonthlySpend(transactions, expense.id, '2026-07')).toBe(200)
  })

  it('returns 0 when there is no historical data', () => {
    expect(averageMonthlySpend([], expense.id, '2026-07')).toBe(0)
    expect(
      averageMonthlySpend([tx({ categoryId: expense.id, date: '2026-07-15' })], expense.id, '2026-07'),
    ).toBe(0)
  })
})

describe('daysLeftInMonth', () => {
  it('counts inclusively from today to the end of the month', () => {
    expect(daysLeftInMonth(new Date(2026, 6, 31))).toBe(1) // last day of July
    expect(daysLeftInMonth(new Date(2026, 6, 30))).toBe(2)
    expect(daysLeftInMonth(new Date(2026, 6, 1))).toBe(31)
  })

  it('never returns less than 1', () => {
    expect(daysLeftInMonth(new Date(2026, 6, 31))).toBeGreaterThanOrEqual(1)
  })
})
