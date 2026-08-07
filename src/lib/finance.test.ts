import { describe, expect, it } from 'vitest'
import type { Account, Category, Transaction, Transfer } from '../db'
import {
  accountBalance,
  averageMonthlySpend,
  buildMonthlySeries,
  buildWeeklySeries,
  daysLeftInMonth,
  isNetWorthTracked,
  netWorth,
  signedAmount,
  spentByCategoryThisMonth,
  spentByCategoryThisWeek,
} from './finance'

const income: Category = { id: 1, name: 'Salary', kind: 'income', color: '#0f0' }
const expense: Category = { id: 2, name: 'Groceries', kind: 'expense', color: '#f00' }
const categoriesById = new Map<number, Category>([
  [income.id, income],
  [expense.id, expense],
])

const gcash: Account = { id: 1, name: 'GCash', type: 'checking', startingBalance: 1000, createdAt: '' }
const savings: Account = { id: 2, name: 'Savings', type: 'savings', startingBalance: 0, createdAt: '' }
const gotrade: Account = { id: 3, name: 'GoTrade', type: 'investment', startingBalance: 0, createdAt: '' }

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

  it('excludes investment accounts, including money transferred into one', () => {
    const transfers = [transfer({ amount: 400, fromAccountId: gcash.id, toAccountId: gotrade.id })]
    // gcash: 1000 - 400 = 600; gotrade (400) excluded entirely.
    expect(netWorth([gcash, savings, gotrade], [], transfers, categoriesById)).toBe(600)
  })
})

describe('isNetWorthTracked', () => {
  it('is false only for investment accounts', () => {
    expect(isNetWorthTracked(gcash)).toBe(true)
    expect(isNetWorthTracked(savings)).toBe(true)
    expect(isNetWorthTracked(gotrade)).toBe(false)
  })
})

describe('buildMonthlySeries net worth', () => {
  it('drops a transfer into an investment account from the tracked total', () => {
    const transfers = [transfer({ amount: 400, fromAccountId: gcash.id, toAccountId: gotrade.id, date: '2026-07-15' })]
    const series = buildMonthlySeries([gcash, savings, gotrade], [], transfers, categoriesById, 1, new Date(2026, 6, 20))
    // starting totals: gcash 1000 + savings 0 (gotrade's 0 excluded either way) - 400 moved out = 600.
    expect(series[0].netWorth).toBe(600)
  })

  it('is unaffected by a transfer between two tracked accounts', () => {
    const transfers = [transfer({ amount: 400, fromAccountId: gcash.id, toAccountId: savings.id, date: '2026-07-15' })]
    const series = buildMonthlySeries([gcash, savings], [], transfers, categoriesById, 1, new Date(2026, 6, 20))
    expect(series[0].netWorth).toBe(1000)
  })

  it('ignores a transfer dated after the month being computed', () => {
    const transfers = [transfer({ amount: 400, fromAccountId: gcash.id, toAccountId: gotrade.id, date: '2026-08-01' })]
    const series = buildMonthlySeries([gcash, savings, gotrade], [], transfers, categoriesById, 1, new Date(2026, 6, 20))
    expect(series[0].netWorth).toBe(1000)
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

describe('spentByCategoryThisWeek', () => {
  it('sums only the given category within the Monday-Sunday week', () => {
    // 2026-07-15 is a Wednesday; its Monday-start week runs 07-13..07-19.
    const transactions = [
      tx({ categoryId: expense.id, date: '2026-07-13', amount: 100 }), // Monday, in week
      tx({ categoryId: expense.id, date: '2026-07-19', amount: 50 }), // Sunday, in week
      tx({ categoryId: expense.id, date: '2026-07-12', amount: 999 }), // previous week
      tx({ categoryId: expense.id, date: '2026-07-20', amount: 999 }), // next week
      tx({ categoryId: income.id, date: '2026-07-15', amount: 999 }), // different category
    ]
    expect(spentByCategoryThisWeek(transactions, expense.id, new Date(2026, 6, 15))).toBe(150)
  })

  it('returns 0 when there is no matching spend', () => {
    expect(spentByCategoryThisWeek([], expense.id, new Date(2026, 6, 15))).toBe(0)
  })
})

describe('buildWeeklySeries', () => {
  it('buckets income/expense into Monday-start weeks, excluding system categories', () => {
    const system: Category = { id: 3, name: 'Balance Adjustment', kind: 'income', color: '#999', system: true }
    const byId = new Map<number, Category>([...categoriesById, [system.id, system]])
    const transactions = [
      tx({ categoryId: income.id, date: '2026-07-06', amount: 500 }), // week of 07-06
      tx({ categoryId: expense.id, date: '2026-07-12', amount: 200 }), // week of 07-06 (Sunday)
      tx({ categoryId: expense.id, date: '2026-07-13', amount: 300 }), // week of 07-13 (Monday)
      tx({ categoryId: income.id, date: '2026-07-19', amount: 400 }), // week of 07-13 (Sunday)
      tx({ categoryId: system.id, date: '2026-07-13', amount: 999 }), // system, excluded
      tx({ categoryId: 999, date: '2026-07-13', amount: 999 }), // unresolved category, skipped
    ]
    const series = buildWeeklySeries([gcash, savings], transactions, byId, 2, new Date(2026, 6, 15))
    expect(series).toEqual([
      { weekKey: '2026-07-06', income: 500, expense: 200 },
      { weekKey: '2026-07-13', income: 400, expense: 300 },
    ])
  })

  it('has no netWorth field', () => {
    const series = buildWeeklySeries([gcash], [], categoriesById, 1, new Date(2026, 6, 15))
    expect(series[0]).not.toHaveProperty('netWorth')
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
