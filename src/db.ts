import Dexie, { type EntityTable } from 'dexie'

export type AccountType = 'checking' | 'savings' | 'credit' | 'cash' | 'investment' | 'ewallet'
export type CategoryKind = 'income' | 'expense'

export interface Account {
  id: number
  name: string
  type: AccountType
  startingBalance: number
  createdAt: string
}

export interface Category {
  id: number
  name: string
  kind: CategoryKind
  color: string
  system?: boolean // hidden from normal category pickers (e.g. balance adjustments)
  archived?: boolean // retired by the user; kept so existing transactions/budgets still resolve, but excluded from normal pickers going forward
}

export interface Transaction {
  id: number
  accountId: number
  categoryId: number
  amount: number // always positive; sign comes from category.kind
  date: string // ISO yyyy-MM-dd
  note: string
  payoutDateId?: number // set when this transaction logs a scheduled payout occurrence
  createdAt: string
}

export type BudgetPeriod = 'weekly' | 'monthly'

export interface Budget {
  id: number
  categoryId: number
  period: BudgetPeriod
  limit: number
}

export interface RecurringBill {
  id: number
  name: string
  amount: number
  dueDay: number // 1-31, clamped to last day of shorter months
  accountId: number
  categoryId: number
  active: boolean
  lastPaidMonth?: string // 'yyyy-MM'
}

// A payout schedule is just the "who/where" (which account and category this
// income lands in). The employer's actual pay dates aren't a simple
// once-a-month formula (e.g. semi-monthly payroll shifts a few days every
// period to dodge weekends/holidays), so each concrete date is its own row
// in PayoutDate rather than a computed "day of month".
export interface PayoutSchedule {
  id: number
  label: string
  accountId: number
  categoryId: number
  active: boolean
}

export interface PayoutDate {
  id: number
  scheduleId: number
  date: string // ISO yyyy-MM-dd — the actual expected payout date
  label?: string // optional context, e.g. the raw "no later than..." line it came from
  loggedTransactionId?: number // set once the user logs the actual amount for this date
}

// Moving money between your own accounts — doesn't touch income/expense
// reporting, just shifts balance from one account to another.
export interface Transfer {
  id: number
  fromAccountId: number
  toAccountId: number
  amount: number
  date: string // ISO yyyy-MM-dd
  note: string
  createdAt: string
}

// A learned mapping from a phrase you typed into the quick-command bar to a
// specific account or category — created when you correct a guess, so the
// same phrase resolves directly (no fuzzy matching) next time.
export interface CommandAlias {
  id: number
  phrase: string // normalized (lowercase, trimmed)
  entityType: 'account' | 'category'
  entityId: number
}

// A same-device, automatic rolling snapshot of the whole database, taken
// periodically without any user action (unlike the manual Export/Import
// backup in lib/backup.ts). Deliberately NOT typed against backup.ts's
// BackupData to avoid a circular import between db.ts and lib/backup.ts —
// this shape is structurally compatible with BackupData, just declared
// independently here.
export interface LocalSnapshot {
  id: number
  createdAt: string // ISO timestamp
  schemaVersion: number
  tables: Record<string, unknown[]>
}

const db = new Dexie('finance-tracker') as Dexie & {
  accounts: EntityTable<Account, 'id'>
  categories: EntityTable<Category, 'id'>
  transactions: EntityTable<Transaction, 'id'>
  budgets: EntityTable<Budget, 'id'>
  recurringBills: EntityTable<RecurringBill, 'id'>
  payoutSchedules: EntityTable<PayoutSchedule, 'id'>
  payoutDates: EntityTable<PayoutDate, 'id'>
  transfers: EntityTable<Transfer, 'id'>
  commandAliases: EntityTable<CommandAlias, 'id'>
  localSnapshots: EntityTable<LocalSnapshot, 'id'>
}

db.version(1).stores({
  accounts: '++id, name, type',
  categories: '++id, name, kind',
  transactions: '++id, accountId, categoryId, date, payoutScheduleId',
  budgets: '++id, categoryId',
  recurringBills: '++id, dueDay, active',
  payoutSchedules: '++id, dayOfMonth, active',
})

db.version(2).stores({
  accounts: '++id, name, type',
  categories: '++id, name, kind',
  transactions: '++id, accountId, categoryId, date, payoutDateId',
  budgets: '++id, categoryId',
  recurringBills: '++id, dueDay, active',
  payoutSchedules: '++id, active',
  payoutDates: '++id, scheduleId, date',
})

db.version(3).stores({
  accounts: '++id, name, type',
  categories: '++id, name, kind',
  transactions: '++id, accountId, categoryId, date, payoutDateId',
  budgets: '++id, categoryId',
  recurringBills: '++id, dueDay, active',
  payoutSchedules: '++id, active',
  payoutDates: '++id, scheduleId, date',
  transfers: '++id, fromAccountId, toAccountId, date',
})

db.version(4).stores({
  accounts: '++id, name, type',
  categories: '++id, name, kind',
  transactions: '++id, accountId, categoryId, date, payoutDateId',
  budgets: '++id, categoryId',
  recurringBills: '++id, dueDay, active',
  payoutSchedules: '++id, active',
  payoutDates: '++id, scheduleId, date',
  transfers: '++id, fromAccountId, toAccountId, date',
  commandAliases: '++id, phrase, entityType',
})

db.version(5).stores({
  accounts: '++id, name, type',
  categories: '++id, name, kind, archived',
  transactions: '++id, accountId, categoryId, date, payoutDateId',
  budgets: '++id, categoryId',
  recurringBills: '++id, dueDay, active',
  payoutSchedules: '++id, active',
  payoutDates: '++id, scheduleId, date',
  transfers: '++id, fromAccountId, toAccountId, date',
  commandAliases: '++id, phrase, entityType',
})

db.version(6).stores({
  accounts: '++id, name, type',
  categories: '++id, name, kind, archived',
  transactions: '++id, accountId, categoryId, date, payoutDateId',
  budgets: '++id, categoryId',
  recurringBills: '++id, dueDay, active',
  payoutSchedules: '++id, active',
  payoutDates: '++id, scheduleId, date',
  transfers: '++id, fromAccountId, toAccountId, date',
  commandAliases: '++id, phrase, entityType',
  localSnapshots: '++id, createdAt',
})

// Budgets gain a period ('weekly' | 'monthly') alongside the renamed
// monthlyLimit -> limit — existing rows are monthly by definition (weekly
// budgets didn't exist before this version), so the upgrade just carries
// their old limit forward under the new field name.
db.version(7)
  .stores({
    accounts: '++id, name, type',
    categories: '++id, name, kind, archived',
    transactions: '++id, accountId, categoryId, date, payoutDateId',
    budgets: '++id, categoryId, period',
    recurringBills: '++id, dueDay, active',
    payoutSchedules: '++id, active',
    payoutDates: '++id, scheduleId, date',
    transfers: '++id, fromAccountId, toAccountId, date',
    commandAliases: '++id, phrase, entityType',
    localSnapshots: '++id, createdAt',
  })
  .upgrade(async (tx) => {
    await tx
      .table('budgets')
      .toCollection()
      .modify((budget) => {
        budget.period = 'monthly'
        budget.limit = budget.monthlyLimit
        delete budget.monthlyLimit
      })
  })

export default db

export async function saveCommandAlias(
  phrase: string,
  entityType: CommandAlias['entityType'],
  entityId: number,
) {
  const normalized = phrase.trim().toLowerCase()
  if (!normalized) return
  const existing = await db.commandAliases
    .where('phrase')
    .equals(normalized)
    .and((a) => a.entityType === entityType)
    .first()
  if (existing) {
    await db.commandAliases.update(existing.id, { entityId })
  } else {
    await db.commandAliases.add({
      id: undefined as unknown as number,
      phrase: normalized,
      entityType,
      entityId,
    })
  }
}

/**
 * Deletes a single learned command alias. Simple delete — nothing else
 * references a command alias row — but we still confirm it exists first so
 * callers get a clear error instead of a silent no-op.
 */
export async function deleteCommandAlias(id: number): Promise<void> {
  const existing = await db.commandAliases.get(id)
  if (!existing) {
    throw new Error('Command alias not found.')
  }
  await db.commandAliases.delete(id)
}

/**
 * Lets the user proactively teach the command bar a phrase (an account
 * nickname, local slang for a category) without first triggering a wrong
 * fuzzy-match guess. Returns the id of the created or updated alias row.
 * Reuses the exact normalization and duplicate-phrase-plus-entityType
 * overwrite behavior as saveCommandAlias, but returns the row id since the
 * Settings UI needs it to reflect the new/updated row immediately.
 */
export async function addCommandAliasManually(
  phrase: string,
  entityType: CommandAlias['entityType'],
  entityId: number,
): Promise<number> {
  const normalized = phrase.trim().toLowerCase()
  if (!normalized) {
    throw new Error('Phrase cannot be empty.')
  }
  const existing = await db.commandAliases
    .where('phrase')
    .equals(normalized)
    .and((a) => a.entityType === entityType)
    .first()
  if (existing) {
    await db.commandAliases.update(existing.id, { entityId })
    return existing.id
  }
  return db.commandAliases.add({
    id: undefined as unknown as number,
    phrase: normalized,
    entityType,
    entityId,
  })
}

/** Patches an existing transaction (amount, category, date, note, etc.). */
export async function updateTransaction(
  id: number,
  patch: Partial<Omit<Transaction, 'id'>>,
): Promise<void> {
  await db.transactions.update(id, patch)
}

/** Permanently removes a single transaction. */
export async function deleteTransaction(id: number): Promise<void> {
  await db.transactions.delete(id)
}

/** Renames an account. Throws if the new name is blank. */
export async function renameAccount(id: number, newName: string): Promise<void> {
  const trimmed = newName.trim()
  if (!trimmed) {
    throw new Error('Account name cannot be empty.')
  }
  await db.accounts.update(id, { name: trimmed })
}

/**
 * Deletes an account, but only if nothing still references it. Cascading
 * deletes would silently destroy transaction/transfer history, so instead we
 * block the delete and tell the user to clear those out first — the
 * simplest policy that can't lose data by surprise.
 */
export async function deleteAccount(id: number): Promise<void> {
  const [transactionCount, transferCount] = await Promise.all([
    db.transactions.where('accountId').equals(id).count(),
    db.transfers.filter((t) => t.fromAccountId === id || t.toAccountId === id).count(),
  ])

  if (transactionCount > 0 || transferCount > 0) {
    throw new Error(
      'This account still has transactions or transfers. Delete or move those first, then delete the account.',
    )
  }

  await db.accounts.delete(id)
}

/**
 * Deletes a recurring bill definition. Unlike an account, nothing else
 * references a bill row (each paid instance becomes its own independent
 * transaction), so — unlike deleteAccount — no referential-integrity guard
 * is needed here.
 */
export async function deleteRecurringBill(id: number): Promise<void> {
  await db.recurringBills.delete(id)
}

/**
 * Deletes a budget's monthly limit for a category. Same reasoning as
 * deleteRecurringBill: nothing else references a budget row, so this is a
 * plain delete.
 */
export async function deleteBudget(id: number): Promise<void> {
  await db.budgets.delete(id)
}

/**
 * Creates a new user-defined category. Rejects a blank name and rejects
 * exact-duplicate name+kind combos (case-insensitive) so the picker never
 * ends up with two indistinguishable "Groceries" entries.
 */
export async function addCategory(input: {
  name: string
  kind: CategoryKind
  color: string
}): Promise<number> {
  const trimmed = input.name.trim()
  if (!trimmed) {
    throw new Error('Category name cannot be empty.')
  }

  const duplicate = await db.categories
    .where('kind')
    .equals(input.kind)
    .and((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase())
    .first()
  if (duplicate) {
    throw new Error(`A ${input.kind} category named "${trimmed}" already exists.`)
  }

  return db.categories.add({
    id: undefined as unknown as number,
    name: trimmed,
    kind: input.kind,
    color: input.color,
  })
}

/**
 * Renames and/or recolors a category. System categories (e.g. Balance
 * Adjustment) are internal plumbing, not user-facing budget buckets, so
 * editing them is blocked outright.
 */
export async function updateCategory(
  id: number,
  patch: Partial<Pick<Category, 'name' | 'color'>>,
): Promise<void> {
  const category = await db.categories.get(id)
  if (!category) {
    throw new Error('Category not found.')
  }
  if (category.system) {
    throw new Error('System categories cannot be renamed or recolored.')
  }

  const update: Partial<Pick<Category, 'name' | 'color'>> = {}
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim()
    if (!trimmed) {
      throw new Error('Category name cannot be empty.')
    }
    update.name = trimmed
  }
  if (patch.color !== undefined) {
    update.color = patch.color
  }

  await db.categories.update(id, update)
}

/**
 * Retires a category from normal pickers without touching the transactions
 * or budgets that already reference it — those keep resolving against the
 * archived row. System categories are never user-facing, so archiving one
 * makes no sense and is refused.
 */
export async function archiveCategory(id: number): Promise<void> {
  const category = await db.categories.get(id)
  if (!category) {
    throw new Error('Category not found.')
  }
  if (category.system) {
    throw new Error('System categories cannot be archived.')
  }
  await db.categories.update(id, { archived: true })
}

/** Restores an archived category to normal pickers. */
export async function unarchiveCategory(id: number): Promise<void> {
  await db.categories.update(id, { archived: false })
}

/**
 * Deletes a category, but only if nothing still references it. Same
 * referential-integrity policy as deleteAccount: cascading deletes would
 * silently orphan transaction/budget history, so instead we block the
 * delete and tell the caller to archive it instead. System categories are
 * never deletable.
 */
export async function deleteCategory(id: number): Promise<void> {
  const category = await db.categories.get(id)
  if (!category) {
    throw new Error('Category not found.')
  }
  if (category.system) {
    throw new Error('System categories cannot be deleted.')
  }

  const [transactionCount, budgetCount] = await Promise.all([
    db.transactions.where('categoryId').equals(id).count(),
    db.budgets.where('categoryId').equals(id).count(),
  ])

  if (transactionCount > 0 || budgetCount > 0) {
    throw new Error(
      'This category still has transactions or a budget using it. Archive it instead of deleting.',
    )
  }

  await db.categories.delete(id)
}

export const BALANCE_ADJUSTMENT_CATEGORY = 'Balance Adjustment'

export async function getOrCreateBalanceAdjustmentCategory(): Promise<Category> {
  const existing = await db.categories.where('name').equals(BALANCE_ADJUSTMENT_CATEGORY).first()
  if (existing) return existing
  const id = await db.categories.add({
    id: undefined as unknown as number,
    name: BALANCE_ADJUSTMENT_CATEGORY,
    kind: 'income',
    color: '#94a3b8',
    system: true,
  })
  return { id, name: BALANCE_ADJUSTMENT_CATEGORY, kind: 'income', color: '#94a3b8', system: true }
}

// The payout dates from the user's actual semi-monthly payroll schedule
// (parsed from the company's published table), so it's there from first
// launch rather than something they have to re-enter.
const KNOWN_PAYOUT_DATES = [
  { date: '2026-08-10', label: 'No later than 4pm of August 10 (Mon)' },
  { date: '2026-08-24', label: 'No later than 4pm of August 24 (Mon)' },
  { date: '2026-09-08', label: 'No later than 4pm of September 8 (Tue)' },
  { date: '2026-09-23', label: 'No later than 4pm of September 23 (Wed)' },
  { date: '2026-10-08', label: 'No later than 4pm of October 8 (Thu)' },
  { date: '2026-10-23', label: 'No later than 4pm of October 23 (Fri)' },
  { date: '2026-11-09', label: 'No later than 4pm of November 9 (Mon)' },
  { date: '2026-11-23', label: 'No later than 4pm of November 23 (Mon)' },
  { date: '2026-12-07', label: 'No later than 4pm of December 7 (Mon)' },
  { date: '2026-12-22', label: 'No later than 4pm of December 22 (Tue)' },
  { date: '2027-01-08', label: 'No later than 4pm of January 8, 2027 (Fri)' },
]

export async function seedIfEmpty() {
  // Wrapped in a single readwrite transaction so two concurrent callers (e.g.
  // React StrictMode's double-invoked effect in dev) can't both pass the
  // count check before either has inserted, which would duplicate seed data.
  await db.transaction(
    'rw',
    [db.accounts, db.categories, db.payoutSchedules, db.payoutDates],
    async () => {
      const accountCount = await db.accounts.count()
      if (accountCount > 0) return

      const now = new Date().toISOString()

      // GCash, GoTyme, Landbank, and Cash are all everyday spending money
      // ("checking") — none of them is a dedicated savings account. Savings
      // is a general bucket you fund yourself via transfers when you want.
      const accounts: Omit<Account, 'id'>[] = [
        { name: 'GCash', type: 'checking', startingBalance: 0, createdAt: now },
        { name: 'GoTyme', type: 'checking', startingBalance: 0, createdAt: now },
        { name: 'Landbank', type: 'checking', startingBalance: 0, createdAt: now },
        { name: 'Cash', type: 'cash', startingBalance: 0, createdAt: now },
        { name: 'Savings', type: 'savings', startingBalance: 0, createdAt: now },
      ]
      const accountIds = await Promise.all(accounts.map((a) => db.accounts.add(a as Account)))
      const goTymeId = accountIds[1]

      const categories: Omit<Category, 'id'>[] = [
        { name: 'Salary', kind: 'income', color: '#22c55e' },
        { name: 'Other Income', kind: 'income', color: '#84cc16' },
        { name: 'Groceries', kind: 'expense', color: '#f97316' },
        { name: 'Rent', kind: 'expense', color: '#ef4444' },
        { name: 'Utilities', kind: 'expense', color: '#eab308' },
        { name: 'Transport', kind: 'expense', color: '#3b82f6' },
        { name: 'Dining', kind: 'expense', color: '#ec4899' },
        { name: 'Subscriptions', kind: 'expense', color: '#a855f7' },
        { name: 'Other Expense', kind: 'expense', color: '#64748b' },
        { name: BALANCE_ADJUSTMENT_CATEGORY, kind: 'income', color: '#94a3b8', system: true },
      ]
      await db.categories.bulkAdd(categories as Category[])

      const salaryCategory = await db.categories.where('name').equals('Salary').first()
      if (salaryCategory) {
        const scheduleId = await db.payoutSchedules.add({
          id: undefined as unknown as number,
          label: 'Salary',
          accountId: goTymeId,
          categoryId: salaryCategory.id,
          active: true,
        } as PayoutSchedule)

        await db.payoutDates.bulkAdd(
          KNOWN_PAYOUT_DATES.map((pd) => ({
            id: undefined as unknown as number,
            scheduleId,
            date: pd.date,
            label: pd.label,
          })),
        )
      }
    },
  )
}
