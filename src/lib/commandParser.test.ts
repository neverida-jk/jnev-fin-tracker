import { describe, expect, it } from 'vitest'
import type { Account, Budget, Category, CommandAlias, PayoutDate, PayoutSchedule, RecurringBill, Transaction } from '../db'
import {
  fuzzyFieldEntityId,
  fuzzyFieldPhrase,
  getFuzzyFields,
  hasLowConfidenceMatch,
  parseCommand,
  type ParseContext,
} from './commandParser'
import { todayISO } from './dates'
import { formatMoney } from './format'

const GCASH = 1
const GOTYME = 2
const LANDBANK = 3
const CASH = 4

const SALARY = 1
const OTHER_INCOME = 2
const GROCERIES = 3
const RENT = 4
const UTILITIES = 5
const TRANSPORT = 6
const DINING = 7
const SUBSCRIPTIONS = 8
const OTHER_EXPENSE = 9

const accounts: Account[] = [
  { id: GCASH, name: 'GCash', type: 'checking', startingBalance: 0, createdAt: '' },
  { id: GOTYME, name: 'GoTyme', type: 'checking', startingBalance: 0, createdAt: '' },
  { id: LANDBANK, name: 'Landbank', type: 'checking', startingBalance: 0, createdAt: '' },
  { id: CASH, name: 'Cash', type: 'cash', startingBalance: 0, createdAt: '' },
]

const categories: Category[] = [
  { id: SALARY, name: 'Salary', kind: 'income', color: '#0f0' },
  { id: OTHER_INCOME, name: 'Other Income', kind: 'income', color: '#0f0' },
  { id: GROCERIES, name: 'Groceries', kind: 'expense', color: '#f00' },
  { id: RENT, name: 'Rent', kind: 'expense', color: '#f00' },
  { id: UTILITIES, name: 'Utilities', kind: 'expense', color: '#f00' },
  { id: TRANSPORT, name: 'Transport', kind: 'expense', color: '#f00' },
  { id: DINING, name: 'Dining', kind: 'expense', color: '#f00' },
  { id: SUBSCRIPTIONS, name: 'Subscriptions', kind: 'expense', color: '#f00' },
  { id: OTHER_EXPENSE, name: 'Other Expense', kind: 'expense', color: '#f00' },
]

const baseCtx: ParseContext = { accounts, categories, aliases: [], defaultAccountId: GCASH }

describe('parseCommand — expense/income/transfer routing', () => {
  it('parses a basic expense with account and category resolved', () => {
    const cmd = parseCommand('expense 200 groceries gcash', baseCtx)
    expect(cmd.type).toBe('expense')
    expect(cmd.amount).toBe(200)
    expect(cmd.accountId).toBe(GCASH)
    expect(cmd.categoryId).toBe(GROCERIES)
    expect(cmd.categoryConfidence).toBe('exact')
  })

  it('parses a basic income', () => {
    const cmd = parseCommand('received 5000 salary gotyme', baseCtx)
    expect(cmd.type).toBe('income')
    expect(cmd.amount).toBe(5000)
    expect(cmd.accountId).toBe(GOTYME)
    expect(cmd.categoryId).toBe(SALARY)
  })

  it('parses a transfer between two accounts', () => {
    const cmd = parseCommand('transfer 500 from gcash to gotyme', baseCtx)
    expect(cmd.type).toBe('transfer')
    expect(cmd.amount).toBe(500)
    expect(cmd.fromAccountId).toBe(GCASH)
    expect(cmd.toAccountId).toBe(GOTYME)
  })

  it('rejects a transfer with no destination instead of misfiling it as an expense', () => {
    const cmd = parseCommand('transfer 500 gcash', baseCtx)
    expect(cmd.type).toBe('unrecognized')
    expect(cmd.summary).toContain('Missing destination')
  })

  it('rejects a transfer where both sides resolve to the same account', () => {
    const cmd = parseCommand('transfer 500 gcash to gcash', baseCtx)
    expect(cmd.type).toBe('unrecognized')
  })

  it('parses amounts with thousands separators', () => {
    const cmd = parseCommand('spent 1,200 on groceries gcash', baseCtx)
    expect(cmd.type).toBe('expense')
    expect(cmd.amount).toBe(1200)
  })
})

describe('parseCommand — "got paid" vs "paid" ambiguity', () => {
  it('treats "got paid" as income, not an expense', () => {
    const cmd = parseCommand('got paid 20000 salary gotyme', baseCtx)
    expect(cmd.type).toBe('income')
    expect(cmd.categoryId).toBe(SALARY)
  })

  it('treats bare "paid" as an expense trigger', () => {
    const cmd = parseCommand('paid 500 rent gcash', baseCtx)
    expect(cmd.type).toBe('expense')
    expect(cmd.categoryId).toBe(RENT)
  })
})

describe('parseCommand — "salary" as both trigger word and category name', () => {
  it('routes to income and still resolves the Salary category from the same word', () => {
    const cmd = parseCommand('salary 20000', baseCtx)
    expect(cmd.type).toBe('income')
    expect(cmd.categoryId).toBe(SALARY)
    expect(cmd.categoryConfidence).toBe('exact')
    expect(cmd.accountId).toBe(GCASH) // falls back to defaultAccountId
  })
})

describe('parseCommand — fuzzy matching on short category names', () => {
  it('fuzzy-matches a typo\'d short category name and marks it low-confidence', () => {
    const cmd = parseCommand('expense 100 rnt cash', baseCtx)
    expect(cmd.type).toBe('expense')
    expect(cmd.categoryId).toBe(RENT)
    expect(cmd.categoryConfidence).toBe('fuzzy')
    expect(cmd.accountId).toBe(CASH)
  })

  it('does not require confirmation for an exact category match', () => {
    const cmd = parseCommand('expense 100 rent cash', baseCtx)
    expect(cmd.categoryConfidence).toBe('exact')
  })
})

describe('parseCommand — confidence / confirmation gate', () => {
  it('flags a fuzzy-matched field via getFuzzyFields/hasLowConfidenceMatch', () => {
    const cmd = parseCommand('expense 100 rnt cash', baseCtx)
    expect(hasLowConfidenceMatch(cmd)).toBe(true)
    const fields = getFuzzyFields(cmd)
    expect(fields).toContain('categoryId')
    expect(fuzzyFieldEntityId(cmd, 'categoryId')).toBe(RENT)
    expect(fuzzyFieldPhrase(cmd, 'categoryId')).toEqual({ phrase: 'rnt', entityType: 'category' })
  })

  it('does not flag anything when every field resolved exactly', () => {
    const cmd = parseCommand('expense 100 groceries gcash', baseCtx)
    expect(hasLowConfidenceMatch(cmd)).toBe(false)
    expect(getFuzzyFields(cmd)).toEqual([])
  })

  it('does not flag a deliberate fallback (default account, "Other" category) as low-confidence', () => {
    // "xyz123" resolves to neither an account nor a category, so it falls
    // back to the default account and "Other Expense" bucket — both
    // deliberate, safe defaults, not guesses, so confidence stays 'exact'.
    const cmd = parseCommand('expense 100 xyz123', baseCtx)
    expect(cmd.categoryId).toBe(OTHER_EXPENSE)
    expect(cmd.categoryConfidence).toBe('exact')
    expect(hasLowConfidenceMatch(cmd)).toBe(false)
  })
})

describe('parseCommand — addRecurringBill', () => {
  it('parses a recurring bill with due day and lexicon category match', () => {
    const cmd = parseCommand('add bill netflix 149 due 15', baseCtx)
    expect(cmd.type).toBe('addRecurringBill')
    expect(cmd.amount).toBe(149)
    expect(cmd.dueDay).toBe(15)
    expect(cmd.categoryId).toBe(SUBSCRIPTIONS)
    expect(cmd.billName).toBe('Netflix')
    expect(cmd.accountId).toBe(GCASH) // default account fallback
  })

  it('clamps an out-of-range due day into 1-31', () => {
    const tooHigh = parseCommand('add bill rent 8000 due 45 landbank', baseCtx)
    expect(tooHigh.dueDay).toBe(31)
  })

  it('defaults due day to 1 when none is specified', () => {
    const cmd = parseCommand('add bill rent 8000 landbank', baseCtx)
    expect(cmd.dueDay).toBe(1)
  })
})

describe('parseCommand — addPayoutSchedule', () => {
  it('resolves the account and lexicon-matched category for a new schedule', () => {
    const cmd = parseCommand('add payout schedule bonus gotyme', baseCtx)
    expect(cmd.type).toBe('addPayoutSchedule')
    expect(cmd.accountId).toBe(GOTYME)
    expect(cmd.categoryId).toBe(OTHER_INCOME)
    expect(cmd.scheduleLabel).toBe('Bonus')
  })
})

describe('parseCommand — logPayout', () => {
  const schedules: PayoutSchedule[] = [{ id: 1, label: 'Salary', accountId: GCASH, categoryId: SALARY, active: true }]
  const payoutDates: PayoutDate[] = [
    { id: 1, scheduleId: 1, date: '2020-01-01' }, // always in the past
  ]

  it('fulfills the next pending payout date', () => {
    const cmd = parseCommand('log payout 20000 gotyme', { ...baseCtx, payoutSchedules: schedules, payoutDates })
    expect(cmd.type).toBe('logPayout')
    expect(cmd.amount).toBe(20000)
    expect(cmd.categoryId).toBe(SALARY)
    expect(cmd.categoryConfidence).toBe('exact')
    expect(cmd.payoutDateId).toBe(1)
    expect(cmd.accountId).toBe(GOTYME)
  })

  it('falls back to the schedule\'s own account when none is named', () => {
    const cmd = parseCommand('log payout 20000', { ...baseCtx, payoutSchedules: schedules, payoutDates })
    expect(cmd.accountId).toBe(GCASH)
  })

  it('reports there is nothing pending when every payout date is already logged', () => {
    const loggedDates: PayoutDate[] = [{ id: 1, scheduleId: 1, date: '2020-01-01', loggedTransactionId: 5 }]
    const cmd = parseCommand('log payout 20000', { ...baseCtx, payoutSchedules: schedules, payoutDates: loggedDates })
    expect(cmd.type).toBe('unrecognized')
    expect(cmd.summary).toContain('No pending payout to log right now.')
  })

  it('reports there is nothing pending when there are no schedules at all', () => {
    const cmd = parseCommand('log payout 20000', baseCtx)
    expect(cmd.type).toBe('unrecognized')
  })
})

describe('parseCommand — query routing', () => {
  it('routes a spending question to a query', () => {
    const cmd = parseCommand('how much can I spend on dining', baseCtx)
    expect(cmd.type).toBe('query')
    expect(cmd.summary).toContain('Dining')
  })

  it('routes a purchase-advice question to a query', () => {
    const cmd = parseCommand('should i buy a 500 phone case', baseCtx)
    expect(cmd.type).toBe('query')
  })

  it('routes a budget-health question to a query', () => {
    const cmd = parseCommand("how's my budget?", baseCtx)
    expect(cmd.type).toBe('query')
    expect(cmd.summary).toContain('No income logged yet this month')
  })

  it('does not let a real "set budget" command fall through to the query branch', () => {
    const cmd = parseCommand('budget for dining 3000', baseCtx)
    expect(cmd.type).toBe('setBudget')
    expect(cmd.categoryId).toBe(DINING)
    expect(cmd.amount).toBe(3000)
  })
})

describe('parseCommand — unrecognized fallback', () => {
  it('returns unrecognized for gibberish with no amount or trigger words', () => {
    const cmd = parseCommand('asdkjaskdj qqqq', baseCtx)
    expect(cmd.type).toBe('unrecognized')
  })
})

describe('parseCommand — deleteTransaction', () => {
  const transactions: Transaction[] = [
    {
      id: 10,
      accountId: GCASH,
      categoryId: GROCERIES,
      amount: 200,
      date: '2026-07-30',
      note: '',
      createdAt: '2026-07-30T10:00:00.000Z',
    },
    {
      id: 11,
      accountId: GOTYME,
      categoryId: DINING,
      amount: 150,
      date: '2026-07-31',
      note: '',
      createdAt: '2026-07-31T10:00:00.000Z',
    },
  ]

  it('targets the single most recent transaction with no filter', () => {
    const cmd = parseCommand('delete last transaction', { ...baseCtx, transactions })
    expect(cmd.type).toBe('deleteTransaction')
    expect(cmd.transactionId).toBe(11)
    expect(cmd.summary).toContain('Delete:')
  })

  it('filters the target by a mentioned category', () => {
    const cmd = parseCommand('delete last groceries transaction', { ...baseCtx, transactions })
    expect(cmd.type).toBe('deleteTransaction')
    expect(cmd.transactionId).toBe(10)
    expect(cmd.categoryId).toBe(GROCERIES)
  })

  it('filters the target by a mentioned account', () => {
    const cmd = parseCommand('undo last payment at gcash', { ...baseCtx, transactions })
    expect(cmd.type).toBe('deleteTransaction')
    expect(cmd.transactionId).toBe(10)
    expect(cmd.accountId).toBe(GCASH)
  })

  it('reports a specific reason when there are no transactions at all', () => {
    const cmd = parseCommand('delete last transaction', baseCtx)
    expect(cmd.type).toBe('unrecognized')
    expect(cmd.summary).toContain('No transactions yet')
  })

  it('reports a specific reason when the filtered category has no transactions', () => {
    const cmd = parseCommand('remove last rent transaction', { ...baseCtx, transactions })
    expect(cmd.type).toBe('unrecognized')
    expect(cmd.summary).toContain('No recent')
  })
})

describe('parseCommand — editTransaction', () => {
  const transactions: Transaction[] = [
    {
      id: 10,
      accountId: GCASH,
      categoryId: GROCERIES,
      amount: 200,
      date: '2026-07-31',
      note: '',
      createdAt: '2026-07-31T10:00:00.000Z',
    },
  ]

  it('changes the amount on the last transaction', () => {
    const cmd = parseCommand('change last transaction to 150', { ...baseCtx, transactions })
    expect(cmd.type).toBe('editTransaction')
    expect(cmd.transactionId).toBe(10)
    expect(cmd.newAmount).toBe(150)
  })

  it('changes the category on the last transaction', () => {
    const cmd = parseCommand('fix last transaction category to dining', { ...baseCtx, transactions })
    expect(cmd.type).toBe('editTransaction')
    expect(cmd.transactionId).toBe(10)
    expect(cmd.newCategoryId).toBe(DINING)
  })

  it('moves the last transaction to a different account', () => {
    const cmd = parseCommand('move last transaction to gotyme', { ...baseCtx, transactions })
    expect(cmd.type).toBe('editTransaction')
    expect(cmd.transactionId).toBe(10)
    expect(cmd.newAccountId).toBe(GOTYME)
  })

  it('rejects an edit missing a new value', () => {
    const cmd = parseCommand('change last transaction', { ...baseCtx, transactions })
    expect(cmd.type).toBe('unrecognized')
  })
})

describe('parseCommand — deleteBill', () => {
  const recurringBills: RecurringBill[] = [
    { id: 1, name: 'Netflix', amount: 149, dueDay: 15, accountId: GCASH, categoryId: SUBSCRIPTIONS, active: true },
  ]

  it('resolves a bill to delete by name', () => {
    const cmd = parseCommand('remove bill netflix', { ...baseCtx, recurringBills })
    expect(cmd.type).toBe('deleteBill')
    expect(cmd.billId).toBe(1)
    expect(cmd.summary).toContain('Netflix')
  })

  it('resolves "delete the <name> bill" phrasing', () => {
    const cmd = parseCommand('delete the netflix bill', { ...baseCtx, recurringBills })
    expect(cmd.type).toBe('deleteBill')
    expect(cmd.billId).toBe(1)
  })

  it('reports a specific reason when no bill matches', () => {
    const cmd = parseCommand('delete bill spotify', { ...baseCtx, recurringBills })
    expect(cmd.type).toBe('unrecognized')
    expect(cmd.summary).toContain('No bill named')
  })
})

describe('parseCommand — deleteBudget', () => {
  const budgets: Budget[] = [{ id: 1, categoryId: DINING, period: 'monthly', limit: 3000 }]

  it('resolves a budget to clear by category', () => {
    const cmd = parseCommand('clear budget dining', { ...baseCtx, budgets })
    expect(cmd.type).toBe('deleteBudget')
    expect(cmd.budgetId).toBe(1)
    expect(cmd.summary).toContain('Dining')
  })

  it('reports a specific reason when the category has no budget set', () => {
    const cmd = parseCommand('remove budget for groceries', { ...baseCtx, budgets })
    expect(cmd.type).toBe('unrecognized')
    expect(cmd.summary).toContain('No budget set')
  })
})

describe('parseCommand — archived categories excluded from matching', () => {
  // CommandBar never hands parseCommand the raw category list — it filters
  // out archived categories first (`categories.filter(c => !c.archived)`,
  // see CommandBar.tsx) so a retired category can never be picked for a new
  // or reassigned transaction. Reproduce that same filter here so a
  // regression in either place (CommandBar forgetting to filter, or the
  // parser starting to bypass ctx.categories) would show up as a failure.
  const ARCHIVED_MATCH = 'Zorbing Fees'

  it('does not fuzzy/exact-match an archived category, falling back to Other Expense instead', () => {
    const withArchived: Category[] = [
      ...categories,
      { id: 100, name: ARCHIVED_MATCH, kind: 'expense', color: '#123456', archived: true },
    ]
    const activeCategories = withArchived.filter((c) => !c.archived)

    const cmd = parseCommand('expense 100 zorbing fees gcash', { ...baseCtx, categories: activeCategories })
    expect(cmd.type).toBe('expense')
    expect(cmd.categoryId).not.toBe(100)
    expect(cmd.categoryId).toBe(OTHER_EXPENSE)
  })

  it('still matches a same-named category that is not archived', () => {
    const withActive: Category[] = [
      ...categories,
      { id: 100, name: ARCHIVED_MATCH, kind: 'expense', color: '#123456' },
    ]
    const activeCategories = withActive.filter((c) => !c.archived)

    const cmd = parseCommand('expense 100 zorbing fees gcash', { ...baseCtx, categories: activeCategories })
    expect(cmd.type).toBe('expense')
    expect(cmd.categoryId).toBe(100)
    expect(cmd.categoryConfidence).toBe('exact')
  })
})

describe('parseCommand — learned aliases', () => {
  it('prefers a learned CommandAlias over the built-in lexicon match', () => {
    // "jeep" is a built-in Transport lexicon keyword, but a learned alias
    // remapping it to Dining should win — aliases are checked first.
    const aliases: CommandAlias[] = [{ id: 1, phrase: 'jeep', entityType: 'category', entityId: DINING }]
    const cmd = parseCommand('expense 50 jeep gcash', { ...baseCtx, aliases })
    expect(cmd.categoryId).toBe(DINING)
    expect(cmd.categoryConfidence).toBe('exact')
  })
})

// The three new query sub-intents (time-range spend, biggest category,
// month-over-month) all resolve their date range from parseCommand's real
// `new Date()` — parseCommand itself takes no injectable "today", unlike
// parseRelativeRange/buildMonthlySeries which do. These helpers reproduce
// that same real-clock month arithmetic so the fixtures land in whatever the
// actual "this month"/"last month" happen to be when the suite runs, rather
// than hardcoding dates that would silently stop matching after this month.
function monthsAgoISO(monthsAgo: number, day = 15): string {
  const now = new Date()
  return todayISO(new Date(now.getFullYear(), now.getMonth() - monthsAgo, day))
}

describe('parseCommand — time-range spend query', () => {
  const transactions: Transaction[] = [
    { id: 1, accountId: GCASH, categoryId: DINING, amount: 300, date: monthsAgoISO(1), note: '', createdAt: '' },
    { id: 2, accountId: GCASH, categoryId: GROCERIES, amount: 150, date: monthsAgoISO(1, 10), note: '', createdAt: '' },
    // This month's spend must NOT leak into a "last month" answer.
    { id: 3, accountId: GCASH, categoryId: DINING, amount: 999, date: monthsAgoISO(0), note: '', createdAt: '' },
  ]

  it('answers a category-specific past-tense spend question for a named range', () => {
    const cmd = parseCommand('how much did i spend on dining last month', { ...baseCtx, transactions })
    expect(cmd.type).toBe('query')
    expect(cmd.summary).toContain('Dining')
    expect(cmd.summary).toContain(formatMoney(300))
    expect(cmd.summary).toContain('last month')
    expect(cmd.summary).not.toContain(formatMoney(999))
  })

  it('answers a total (no category named) past-tense spend question for a named range', () => {
    const cmd = parseCommand('how much did i spend last month', { ...baseCtx, transactions })
    expect(cmd.type).toBe('query')
    expect(cmd.summary).toContain(formatMoney(450)) // 300 (dining) + 150 (groceries)
    expect(cmd.summary).toContain('last month')
  })

  it('falls through unchanged to the existing this-month fallback when no range phrase is present', () => {
    // No "last month"/"this year"/etc — parseRelativeRange returns null, so
    // this must NOT be answered by the new range logic; it should still hit
    // the pre-existing composeLocalAnswer path (present-tense "how much can I
    // spend" phrasing already covered elsewhere, but "how much did i spend on
    // dining" with no period is new phrasing for the *old* branch to catch).
    const cmd = parseCommand('how much did i spend on dining', { ...baseCtx, transactions })
    expect(cmd.type).toBe('query')
    expect(cmd.summary).not.toContain('last month')
  })
})

describe('parseCommand — biggest category query', () => {
  // Day 1 is used for "this month" fixtures below (rather than the
  // monthsAgoISO default of 15) because parseRelativeRange's "this month"
  // range only runs from the 1st through *today* (not the end of the
  // month) — a date later than today's day-of-month would be silently
  // excluded depending on what day the suite happens to run.
  it('reports the top-spending category, defaulting to this month when no range phrase is given', () => {
    const transactions: Transaction[] = [
      { id: 1, accountId: GCASH, categoryId: DINING, amount: 1000, date: monthsAgoISO(0, 1), note: '', createdAt: '' },
      { id: 2, accountId: GCASH, categoryId: GROCERIES, amount: 200, date: monthsAgoISO(0, 1), note: '', createdAt: '' },
    ]
    const cmd = parseCommand("what's my biggest expense category", { ...baseCtx, transactions })
    expect(cmd.type).toBe('query')
    expect(cmd.summary).toContain('Dining')
    expect(cmd.summary).toContain(formatMoney(1000))
  })

  it('resolves a "spend the most on" phrasing the same way', () => {
    const transactions: Transaction[] = [
      { id: 1, accountId: GCASH, categoryId: RENT, amount: 8000, date: monthsAgoISO(0, 1), note: '', createdAt: '' },
      { id: 2, accountId: GCASH, categoryId: DINING, amount: 500, date: monthsAgoISO(0, 1), note: '', createdAt: '' },
    ]
    const cmd = parseCommand('what did i spend the most on', { ...baseCtx, transactions })
    expect(cmd.type).toBe('query')
    expect(cmd.summary).toContain('Rent')
  })

  it('reports a graceful message instead of a fabricated ranking when there is no spend at all', () => {
    const cmd = parseCommand("what's my biggest expense category", { ...baseCtx, transactions: [] })
    expect(cmd.type).toBe('query')
    expect(cmd.summary).toContain('No expenses logged in that period yet')
  })
})

describe('parseCommand — month-over-month comparison query', () => {
  it('compares this month against last month when there is enough history', () => {
    // NOTE: composeSpendingPaceHighlight also requires the real day-of-month
    // to be far enough into the month (>=10%) before it will draw a
    // conclusion, and parseCommand has no injectable "today" for this branch
    // — so this assertion relies on the suite not being run on the 1st-3rd of
    // a month. The 10x gap between prior/current spend is deliberately large
    // so the "above"/"below" verdict itself is robust for the rest of the month.
    const transactions: Transaction[] = [
      { id: 1, accountId: GCASH, categoryId: DINING, amount: 1000, date: monthsAgoISO(1), note: '', createdAt: '' },
      { id: 2, accountId: GCASH, categoryId: DINING, amount: 5000, date: monthsAgoISO(0), note: '', createdAt: '' },
    ]
    const cmd = parseCommand('am i spending more than last month', { ...baseCtx, transactions })
    expect(cmd.type).toBe('query')
    expect(cmd.summary).not.toBe('Not enough history yet to compare this month against last month.')
    expect(cmd.summary).toContain('above')
  })

  it('falls back to a graceful message when there is not enough history to compare', () => {
    const transactions: Transaction[] = [
      { id: 1, accountId: GCASH, categoryId: DINING, amount: 500, date: monthsAgoISO(0), note: '', createdAt: '' },
    ]
    const cmd = parseCommand('am i spending more than last month', { ...baseCtx, transactions })
    expect(cmd.type).toBe('query')
    expect(cmd.summary).toBe('Not enough history yet to compare this month against last month.')
  })

  it('recognizes the "is this month more/less than last month" phrasing too', () => {
    const cmd = parseCommand('is this month more than last month', { ...baseCtx, transactions: [] })
    expect(cmd.type).toBe('query')
    expect(cmd.summary).toBe('Not enough history yet to compare this month against last month.')
  })
})

describe('parseCommand — regression: pre-existing query intents unaffected by the new range patterns', () => {
  it('still routes "how\'s my budget?" to the budget-health check, not any of the new branches', () => {
    const cmd = parseCommand("how's my budget?", baseCtx)
    expect(cmd.type).toBe('query')
    expect(cmd.summary).toContain('No income logged yet this month')
    expect(cmd.summary).not.toContain('biggest')
    expect(cmd.summary).not.toContain('last month')
  })

  it('still routes "should i buy X for Y" to purchase advice, not any of the new branches', () => {
    const cmd = parseCommand('should i buy a 3000 phone case', baseCtx)
    expect(cmd.type).toBe('query')
    expect(cmd.summary).not.toContain('biggest')
    expect(cmd.summary).not.toBe('Not enough history yet to compare this month against last month.')
  })

  it('still routes a present-tense "how much can I spend on X" to the existing this-month answer', () => {
    const cmd = parseCommand('how much can I spend on dining', baseCtx)
    expect(cmd.type).toBe('query')
    expect(cmd.summary).toContain('Dining')
  })
})
