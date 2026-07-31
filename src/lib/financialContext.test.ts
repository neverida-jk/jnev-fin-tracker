import { describe, expect, it } from 'vitest'
import type { Account, Budget, Category, Transaction } from '../db'
import {
  buildFinancialContext,
  composeBudgetHealthCheck,
  composeLocalAnswer,
  composePurchaseAdvice,
  type FinancialContext,
} from './financialContext'
import { formatMoney } from './format'

const accounts: Account[] = [{ id: 1, name: 'GCash', type: 'checking', startingBalance: 1000, createdAt: '' }]

const categories: Category[] = [
  { id: 1, name: 'Salary', kind: 'income', color: '#0f0' },
  { id: 2, name: 'Groceries', kind: 'expense', color: '#f00' },
  { id: 3, name: 'Rent', kind: 'expense', color: '#f00' },
  { id: 4, name: 'Dining', kind: 'expense', color: '#f00' },
]

function tx(overrides: Partial<Transaction>): Transaction {
  return { id: Math.random(), accountId: 1, categoryId: 2, amount: 0, date: '2026-07-01', note: '', createdAt: '', ...overrides }
}

const TODAY = new Date(2026, 6, 15) // July 15, 2026 → 17 days left in the month

describe('buildFinancialContext', () => {
  it('aggregates net worth, per-category spend, and income/expense totals', () => {
    const transactions: Transaction[] = [
      tx({ id: 1, categoryId: 1, amount: 20000, date: '2026-07-05' }), // Salary income
      tx({ id: 2, categoryId: 2, amount: 1500, date: '2026-07-10' }), // Groceries expense
      tx({ id: 3, categoryId: 3, amount: 8000, date: '2026-06-01' }), // Rent, previous month
    ]
    const budgets: Budget[] = [{ id: 1, categoryId: 2, monthlyLimit: 5000 }]

    const ctx = buildFinancialContext(accounts, categories, transactions, [], budgets, TODAY)

    expect(ctx.netWorth).toBe(1000 + 20000 - 1500 - 8000) // account balance is all-time, includes the June rent expense too
    expect(ctx.incomeThisMonth).toBe(20000)
    expect(ctx.expenseThisMonth).toBe(1500)
    const groceries = ctx.categories.find((c) => c.name === 'Groceries')
    expect(groceries?.spentThisMonth).toBe(1500)
    expect(groceries?.budget).toBe(5000)
    const rent = ctx.categories.find((c) => c.name === 'Rent')
    expect(rent?.spentThisMonth).toBe(0) // June transaction isn't "this month"
    expect(rent?.avgMonthlyHistorical).toBe(8000)
  })

  it('does not blow up when a transaction references a category that no longer exists', () => {
    const transactions: Transaction[] = [tx({ id: 1, categoryId: 999, amount: 5000 })]
    const ctx = buildFinancialContext(accounts, categories, transactions, [], [], TODAY)
    expect(ctx.netWorth).toBe(1000)
  })
})

function makeContext(overrides: Partial<FinancialContext> = {}): FinancialContext {
  return {
    monthKey: '2026-07',
    daysLeftInMonth: 17,
    netWorth: 1000,
    accounts: [{ name: 'GCash', balance: 1000 }],
    categories: [],
    incomeThisMonth: 0,
    expenseThisMonth: 0,
    ...overrides,
  }
}

describe('composeLocalAnswer', () => {
  it('reports remaining budget and a per-day allowance when under budget', () => {
    const ctx = makeContext({
      categories: [{ name: 'Groceries', kind: 'expense', budget: 5000, spentThisMonth: 2000, avgMonthlyHistorical: 0 }],
    })
    const answer = composeLocalAnswer(ctx, 'Groceries')
    expect(answer).toContain(formatMoney(3000)) // remaining
    expect(answer).toContain(formatMoney(5000)) // budget
    expect(answer).toContain(formatMoney(2000)) // spent
  })

  it('reports being over budget', () => {
    const ctx = makeContext({
      categories: [{ name: 'Groceries', kind: 'expense', budget: 2000, spentThisMonth: 2500, avgMonthlyHistorical: 0 }],
    })
    const answer = composeLocalAnswer(ctx, 'Groceries')
    expect(answer).toBe(`You're ${formatMoney(500)} over your Groceries budget this month (spent ${formatMoney(2500)} of ${formatMoney(2000)}).`)
  })

  it('falls back to historical average when no budget is set', () => {
    const ctx = makeContext({
      categories: [{ name: 'Dining', kind: 'expense', spentThisMonth: 300, avgMonthlyHistorical: 1200 }],
    })
    const answer = composeLocalAnswer(ctx, 'Dining')
    expect(answer).toContain(formatMoney(1200))
    expect(answer).toContain('No budget set for Dining yet')
  })

  it('handles no budget and no history but some spend this month', () => {
    const ctx = makeContext({
      categories: [{ name: 'Dining', kind: 'expense', spentThisMonth: 300, avgMonthlyHistorical: 0 }],
    })
    expect(composeLocalAnswer(ctx, 'Dining')).toBe(
      `No budget set for Dining yet. You've spent ${formatMoney(300)} so far this month — set a budget in the Budgets tab to get a real answer next time.`,
    )
  })

  it('handles no budget, no history, and no spend', () => {
    const ctx = makeContext({
      categories: [{ name: 'Dining', kind: 'expense', spentThisMonth: 0, avgMonthlyHistorical: 0 }],
    })
    expect(composeLocalAnswer(ctx, 'Dining')).toBe(
      'No budget set for Dining, and no spending logged yet this month — log a few transactions and ask again.',
    )
  })

  it('reports an unknown category by name', () => {
    const ctx = makeContext({ categories: [] })
    expect(composeLocalAnswer(ctx, 'Crypto')).toBe('I don\'t have a "Crypto" category to check yet.')
  })

  it('suggests a budget breakdown from historical spend when no category is named', () => {
    const ctx = makeContext({
      categories: [
        { name: 'Rent', kind: 'expense', spentThisMonth: 0, avgMonthlyHistorical: 8000 },
        { name: 'Dining', kind: 'expense', spentThisMonth: 0, avgMonthlyHistorical: 2000 },
        { name: 'Salary', kind: 'income', spentThisMonth: 0, avgMonthlyHistorical: 20000 }, // excluded, not expense
      ],
    })
    const answer = composeLocalAnswer(ctx)
    expect(answer.indexOf('Rent')).toBeLessThan(answer.indexOf('Dining')) // sorted descending
    expect(answer).not.toContain('Salary')
    expect(answer).toContain(formatMoney(10000)) // total
  })

  it('says there is not enough history when nothing has been spent yet', () => {
    const ctx = makeContext({ categories: [{ name: 'Rent', kind: 'expense', spentThisMonth: 0, avgMonthlyHistorical: 0 }] })
    expect(composeLocalAnswer(ctx)).toBe('Not enough transaction history yet to suggest a budget — log expenses for a few weeks and ask again.')
  })
})

describe('composeBudgetHealthCheck', () => {
  it('asks for income to be logged first when there is none this month', () => {
    const ctx = makeContext({ incomeThisMonth: 0 })
    expect(composeBudgetHealthCheck(ctx)).toContain("No income logged yet this month")
  })

  it('reports healthy when the split matches 50/30/20 within tolerance', () => {
    const ctx = makeContext({
      incomeThisMonth: 10000,
      expenseThisMonth: 8000,
      categories: [
        { name: 'Rent', kind: 'expense', spentThisMonth: 5000, avgMonthlyHistorical: 0 }, // needs
        { name: 'Dining', kind: 'expense', spentThisMonth: 3000, avgMonthlyHistorical: 0 }, // wants
      ],
    })
    // needs 50%, wants 30%, saved (10000-8000)/10000 = 20% — exactly on target
    expect(composeBudgetHealthCheck(ctx)).toContain('healthy')
  })

  it('flags needs, wants, and savings that are off guideline', () => {
    const ctx = makeContext({
      incomeThisMonth: 10000,
      expenseThisMonth: 9500,
      categories: [
        { name: 'Rent', kind: 'expense', spentThisMonth: 7000, avgMonthlyHistorical: 0 }, // needs 70% > 55%
        { name: 'Dining', kind: 'expense', spentThisMonth: 2500, avgMonthlyHistorical: 0 }, // wants 25%
      ],
    })
    const answer = composeBudgetHealthCheck(ctx)
    expect(answer).toContain('needs are above the usual 50% guideline')
    expect(answer).toContain("you're saving less than the usual 20% guideline") // saved 5% << 20%
  })
})

describe('composePurchaseAdvice', () => {
  it('asks for a price when no amount was given', () => {
    expect(composePurchaseAdvice(makeContext(), undefined)).toContain('Tell me the price too')
  })

  it('adds a cooldown note for amounts at or above the impulse threshold', () => {
    const answer = composePurchaseAdvice(makeContext({ netWorth: 0 }), 1000)
    expect(answer).toContain('sleep on it')
  })

  it('omits the cooldown note for smaller amounts', () => {
    const answer = composePurchaseAdvice(makeContext({ netWorth: 0 }), 500)
    expect(answer).not.toContain('sleep on it')
  })

  it('warns when a purchase would exceed the remaining category budget', () => {
    const ctx = makeContext({
      categories: [{ name: 'Dining', kind: 'expense', budget: 1000, spentThisMonth: 800, avgMonthlyHistorical: 0 }],
    })
    const answer = composePurchaseAdvice(ctx, 300, 'Dining')
    expect(answer).toContain(`${formatMoney(100)} over what's left in Dining`)
  })

  it('cautions when a purchase eats more than half of what remains', () => {
    const ctx = makeContext({
      categories: [{ name: 'Dining', kind: 'expense', budget: 1000, spentThisMonth: 0, avgMonthlyHistorical: 0 }],
    })
    // remaining = 1000, spending 600 > 50% of 1000
    const answer = composePurchaseAdvice(ctx, 600, 'Dining')
    expect(answer).toContain("it'll eat more than half of what's left")
  })

  it('says a purchase fits comfortably within the remaining budget', () => {
    const ctx = makeContext({
      categories: [{ name: 'Dining', kind: 'expense', budget: 1000, spentThisMonth: 0, avgMonthlyHistorical: 0 }],
    })
    const answer = composePurchaseAdvice(ctx, 100, 'Dining')
    expect(answer).toContain('fits comfortably')
  })

  it('warns when a purchase with no budget/category is over half of net worth', () => {
    const ctx = makeContext({ netWorth: 1000 })
    const answer = composePurchaseAdvice(ctx, 600)
    expect(answer).toContain('over half your current net worth')
  })

  it('falls back to a generic no-budget-to-check message otherwise', () => {
    const ctx = makeContext({ netWorth: 1000 })
    const answer = composePurchaseAdvice(ctx, 100)
    expect(answer).toContain("I don't have a specific budget to check that against")
  })
})
