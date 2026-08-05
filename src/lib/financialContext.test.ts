import { describe, expect, it } from 'vitest'
import type { Account, Budget, Category, Transaction } from '../db'
import {
  buildFinancialContext,
  composeBudgetHealthCheck,
  composeBudgetPaceHighlight,
  composeLocalAnswer,
  composePersonalizedHighlight,
  composePurchaseAdvice,
  composeSpendingPaceHighlight,
  type FinancialContext,
} from './financialContext'
import { formatMoney } from './format'
import type { MonthlyPoint } from './finance'

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

describe('composeBudgetPaceHighlight', () => {
  it('returns null when no expense category has crossed the 75% threshold', () => {
    const ctx = makeContext({
      categories: [{ name: 'Dining', kind: 'expense', budget: 3000, spentThisMonth: 2000, avgMonthlyHistorical: 0 }],
    })
    expect(composeBudgetPaceHighlight(ctx)).toBeNull()
  })

  it('ignores expense categories with no budget set', () => {
    const ctx = makeContext({
      categories: [{ name: 'Dining', kind: 'expense', spentThisMonth: 5000, avgMonthlyHistorical: 0 }],
    })
    expect(composeBudgetPaceHighlight(ctx)).toBeNull()
  })

  it('ignores income categories even if spend exceeds a "budget" value', () => {
    const ctx = makeContext({
      categories: [{ name: 'Salary', kind: 'income', budget: 1000, spentThisMonth: 1000, avgMonthlyHistorical: 0 }],
    })
    expect(composeBudgetPaceHighlight(ctx)).toBeNull()
  })

  it('flags the category with the highest budget-usage fraction once at or above 75%', () => {
    const ctx = makeContext({
      daysLeftInMonth: 9,
      categories: [
        { name: 'Dining', kind: 'expense', budget: 3000, spentThisMonth: 2460, avgMonthlyHistorical: 0 }, // 82%
        { name: 'Transport', kind: 'expense', budget: 2000, spentThisMonth: 1000, avgMonthlyHistorical: 0 }, // 50%
      ],
    })
    expect(composeBudgetPaceHighlight(ctx)).toBe(
      `Dining is already 82% through its ${formatMoney(3000)} budget, with 9 days left this month.`,
    )
  })

  it('reports being over budget once spend has passed 100%, using the singular "day" at 1 day left', () => {
    const ctx = makeContext({
      daysLeftInMonth: 1,
      categories: [{ name: 'Rent', kind: 'expense', budget: 8000, spentThisMonth: 9000, avgMonthlyHistorical: 0 }],
    })
    expect(composeBudgetPaceHighlight(ctx)).toBe(
      `Rent is already over its ${formatMoney(8000)} budget this month, with 1 day left.`,
    )
  })
})

const JULY_10 = new Date(2026, 6, 10) // July 10, 2026 — a 31-day month, ~32% elapsed

function paceSeries(priorExpense: number, currentExpense: number): MonthlyPoint[] {
  return [
    { monthKey: '2026-06', income: 0, expense: priorExpense, netWorth: 0 },
    { monthKey: '2026-07', income: 0, expense: currentExpense, netWorth: 0 },
  ]
}

describe('composeSpendingPaceHighlight', () => {
  it('returns null with fewer than two months of series data', () => {
    expect(
      composeSpendingPaceHighlight([{ monthKey: '2026-07', income: 0, expense: 1000, netWorth: 0 }], JULY_10),
    ).toBeNull()
  })

  it('returns null when the prior month had no expenses to compare against', () => {
    expect(composeSpendingPaceHighlight(paceSeries(0, 1000), JULY_10)).toBeNull()
  })

  it('returns null too early in the month, even with a big apparent gap', () => {
    const earlyInMonth = new Date(2026, 6, 1) // day 1 of 31 -> ~3% elapsed, below the 10% minimum
    expect(composeSpendingPaceHighlight(paceSeries(10000, 100000), earlyInMonth)).toBeNull()
  })

  it('returns null when the pace gap is within the normal range', () => {
    // expectedByNow = 10000 * 10/31 ~= 3225.81; 5% above that is well under the 15% threshold
    const expectedByNow = 10000 * (10 / 31)
    expect(composeSpendingPaceHighlight(paceSeries(10000, expectedByNow * 1.05), JULY_10)).toBeNull()
  })

  it("flags spending running significantly above last month's pace", () => {
    const expectedByNow = 10000 * (10 / 31)
    const current = expectedByNow * 1.24
    const message = composeSpendingPaceHighlight(paceSeries(10000, current), JULY_10)
    expect(message).toBe(
      `Spending this month is running about 24% above last month's pace at this point (${formatMoney(current)} so far vs ${formatMoney(expectedByNow)} expected by now).`,
    )
  })

  it("flags spending running significantly below last month's pace", () => {
    const expectedByNow = 10000 * (10 / 31)
    const current = expectedByNow * 0.7 // 30% below, past the threshold
    const message = composeSpendingPaceHighlight(paceSeries(10000, current), JULY_10)
    expect(message).toContain('below')
    expect(message).toContain('30%')
  })
})

describe('composePersonalizedHighlight', () => {
  it('prefers the budget pace highlight over the spending pace highlight when both are available', () => {
    const ctx = makeContext({
      daysLeftInMonth: 5,
      categories: [{ name: 'Dining', kind: 'expense', budget: 1000, spentThisMonth: 900, avgMonthlyHistorical: 0 }],
    })
    const expectedByNow = 10000 * (10 / 31)
    const series = paceSeries(10000, expectedByNow * 1.5) // would also trigger the spending-pace highlight
    const result = composePersonalizedHighlight(ctx, series, JULY_10)
    expect(result).toContain('Dining')
  })

  it('falls back to the spending pace highlight when no category is close to its budget', () => {
    const ctx = makeContext({ categories: [] })
    const expectedByNow = 10000 * (10 / 31)
    const series = paceSeries(10000, expectedByNow * 1.3)
    const result = composePersonalizedHighlight(ctx, series, JULY_10)
    expect(result).toContain('above')
  })

  it('returns null when there is not enough grounded data for either highlight (e.g. a brand-new install)', () => {
    const ctx = makeContext({ categories: [] })
    expect(composePersonalizedHighlight(ctx, [], JULY_10)).toBeNull()
  })
})
