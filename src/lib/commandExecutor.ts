import db, { deleteBudget, deleteRecurringBill, getOrCreateBalanceAdjustmentCategory } from '../db'
import type { Transaction } from '../db'
import type { ParsedCommand } from './commandParser'

export interface ExecutionResult {
  ok: boolean
  message: string
  undo?: () => Promise<void>
  /** Set for expense/income results — lets the UI patch the account/category
   * afterward (and save the correction as a learned alias). */
  transactionId?: number
  accountPhrase?: string
  categoryPhrase?: string
}

export async function executeCommand(cmd: ParsedCommand): Promise<ExecutionResult> {
  switch (cmd.type) {
    case 'expense':
    case 'income': {
      if (!cmd.amount || cmd.accountId === undefined || cmd.categoryId === undefined) {
        return { ok: false, message: "Couldn't figure out the account or category for that." }
      }

      const id = await db.transactions.add({
        id: undefined as unknown as number,
        accountId: cmd.accountId,
        categoryId: cmd.categoryId,
        amount: cmd.amount,
        date: cmd.date,
        note: cmd.note ?? '',
        createdAt: new Date().toISOString(),
      })
      return {
        ok: true,
        message: cmd.summary,
        transactionId: id,
        accountPhrase: cmd.accountPhrase,
        categoryPhrase: cmd.categoryPhrase,
        undo: async () => {
          await db.transactions.delete(id)
        },
      }
    }

    case 'transfer': {
      if (!cmd.amount || cmd.fromAccountId === undefined || cmd.toAccountId === undefined) {
        return { ok: false, message: "Couldn't figure out the two accounts for that transfer." }
      }
      const id = await db.transfers.add({
        id: undefined as unknown as number,
        fromAccountId: cmd.fromAccountId,
        toAccountId: cmd.toAccountId,
        amount: cmd.amount,
        date: cmd.date,
        note: cmd.raw,
        createdAt: new Date().toISOString(),
      })
      return {
        ok: true,
        message: cmd.summary,
        undo: async () => {
          await db.transfers.delete(id)
        },
      }
    }

    case 'addBalance': {
      if (!cmd.amount || cmd.accountId === undefined) {
        return { ok: false, message: "Couldn't figure out which account to add balance to." }
      }
      const category = await getOrCreateBalanceAdjustmentCategory()
      const id = await db.transactions.add({
        id: undefined as unknown as number,
        accountId: cmd.accountId,
        categoryId: category.id,
        amount: cmd.amount,
        date: cmd.date,
        note: cmd.raw,
        createdAt: new Date().toISOString(),
      })
      return {
        ok: true,
        message: cmd.summary,
        undo: async () => {
          await db.transactions.delete(id)
        },
      }
    }

    case 'createAccount': {
      if (!cmd.newAccountName) {
        return { ok: false, message: "Couldn't figure out the account name." }
      }
      const lowerName = cmd.newAccountName.toLowerCase()
      const type = lowerName.includes('cash')
        ? 'cash'
        : lowerName.includes('sav')
          ? 'savings'
          : 'checking'

      const accountId = await db.accounts.add({
        id: undefined as unknown as number,
        name: cmd.newAccountName,
        type,
        startingBalance: 0,
        createdAt: new Date().toISOString(),
      })

      let transactionId: number | undefined
      if (cmd.amount) {
        const category = await getOrCreateBalanceAdjustmentCategory()
        transactionId = await db.transactions.add({
          id: undefined as unknown as number,
          accountId,
          categoryId: category.id,
          amount: cmd.amount,
          date: cmd.date,
          note: cmd.raw,
          createdAt: new Date().toISOString(),
        })
      }

      return {
        ok: true,
        message: cmd.summary,
        undo: async () => {
          if (transactionId !== undefined) await db.transactions.delete(transactionId)
          await db.accounts.delete(accountId)
        },
      }
    }

    case 'setBudget': {
      if (cmd.amount === undefined || cmd.categoryId === undefined) {
        return { ok: false, message: "Couldn't figure out the category or amount for that budget." }
      }
      const existing = await db.budgets.where('categoryId').equals(cmd.categoryId).first()
      if (existing) {
        const previousLimit = existing.limit
        await db.budgets.update(existing.id, { limit: cmd.amount })
        return {
          ok: true,
          message: cmd.summary,
          undo: async () => {
            await db.budgets.update(existing.id, { limit: previousLimit })
          },
        }
      }
      // Command-bar-created budgets default to monthly — there's no weekly
      // phrasing wired into the parser yet; weekly budgets are created via
      // the Budgets page's period toggle.
      const id = await db.budgets.add({
        id: undefined as unknown as number,
        categoryId: cmd.categoryId,
        period: 'monthly',
        limit: cmd.amount,
      })
      return {
        ok: true,
        message: cmd.summary,
        undo: async () => {
          await db.budgets.delete(id)
        },
      }
    }

    case 'addRecurringBill': {
      if (!cmd.amount || cmd.accountId === undefined || cmd.categoryId === undefined || !cmd.billName) {
        return { ok: false, message: "Couldn't figure out the bill's name, amount, account, or category." }
      }
      const id = await db.recurringBills.add({
        id: undefined as unknown as number,
        name: cmd.billName,
        amount: cmd.amount,
        frequency: 'monthly',
        dueDay: cmd.dueDay ?? 1,
        accountId: cmd.accountId,
        categoryId: cmd.categoryId,
        active: true,
      })
      return {
        ok: true,
        message: cmd.summary,
        undo: async () => {
          await db.recurringBills.delete(id)
        },
      }
    }

    case 'addPayoutSchedule': {
      if (cmd.accountId === undefined || cmd.categoryId === undefined || !cmd.scheduleLabel) {
        return { ok: false, message: "Couldn't figure out the payout schedule's label, account, or category." }
      }
      const id = await db.payoutSchedules.add({
        id: undefined as unknown as number,
        label: cmd.scheduleLabel,
        accountId: cmd.accountId,
        categoryId: cmd.categoryId,
        active: true,
      })
      return {
        ok: true,
        message: cmd.summary,
        undo: async () => {
          await db.payoutSchedules.delete(id)
        },
      }
    }

    case 'logPayout': {
      if (!cmd.amount || cmd.accountId === undefined || cmd.categoryId === undefined || cmd.payoutDateId === undefined) {
        return { ok: false, message: "Couldn't figure out the payout details." }
      }
      const payoutDateId = cmd.payoutDateId
      const id = await db.transactions.add({
        id: undefined as unknown as number,
        accountId: cmd.accountId,
        categoryId: cmd.categoryId,
        amount: cmd.amount,
        date: cmd.date,
        note: cmd.raw,
        payoutDateId,
        createdAt: new Date().toISOString(),
      })
      await db.payoutDates.update(payoutDateId, { loggedTransactionId: id })
      return {
        ok: true,
        message: cmd.summary,
        transactionId: id,
        accountPhrase: cmd.accountPhrase,
        undo: async () => {
          await db.payoutDates.update(payoutDateId, { loggedTransactionId: undefined })
          await db.transactions.delete(id)
        },
      }
    }

    case 'deleteTransaction': {
      if (cmd.transactionId === undefined) {
        return { ok: false, message: "Couldn't figure out which transaction to delete." }
      }
      const transactionId = cmd.transactionId
      const deleted = await db.transactions.get(transactionId)
      if (!deleted) {
        return { ok: false, message: 'That transaction no longer exists.' }
      }
      await db.transactions.delete(transactionId)
      return {
        ok: true,
        message: cmd.summary,
        undo: async () => {
          // Re-inserts the exact row (same id and all), not a fresh add —
          // Dexie allows an explicit primary key value on an auto-increment
          // ('++id') table as long as it's free, which it is right after the
          // delete above.
          await db.transactions.add(deleted)
        },
      }
    }

    case 'editTransaction': {
      if (cmd.transactionId === undefined) {
        return { ok: false, message: "Couldn't figure out which transaction to edit." }
      }
      const transactionId = cmd.transactionId
      const previous = await db.transactions.get(transactionId)
      if (!previous) {
        return { ok: false, message: 'That transaction no longer exists.' }
      }

      const patch: Partial<Omit<Transaction, 'id'>> = {}
      if (cmd.newAmount !== undefined) patch.amount = cmd.newAmount
      if (cmd.newCategoryId !== undefined) patch.categoryId = cmd.newCategoryId
      if (cmd.newAccountId !== undefined) patch.accountId = cmd.newAccountId
      if (Object.keys(patch).length === 0) {
        return { ok: false, message: "Couldn't figure out what to change on that transaction." }
      }

      await db.transactions.update(transactionId, patch)
      return {
        ok: true,
        message: cmd.summary,
        transactionId,
        undo: async () => {
          await db.transactions.update(transactionId, {
            amount: previous.amount,
            categoryId: previous.categoryId,
            accountId: previous.accountId,
          })
        },
      }
    }

    case 'deleteBill': {
      if (cmd.billId === undefined) {
        return { ok: false, message: "Couldn't figure out which bill to delete." }
      }
      const billId = cmd.billId
      const deleted = await db.recurringBills.get(billId)
      if (!deleted) {
        return { ok: false, message: 'That bill no longer exists.' }
      }
      await deleteRecurringBill(billId)
      return {
        ok: true,
        message: cmd.summary,
        undo: async () => {
          await db.recurringBills.add(deleted)
        },
      }
    }

    case 'deleteBudget': {
      if (cmd.budgetId === undefined) {
        return { ok: false, message: "Couldn't figure out which budget to clear." }
      }
      const budgetId = cmd.budgetId
      const deleted = await db.budgets.get(budgetId)
      if (!deleted) {
        return { ok: false, message: 'That budget no longer exists.' }
      }
      await deleteBudget(budgetId)
      return {
        ok: true,
        message: cmd.summary,
        undo: async () => {
          await db.budgets.add(deleted)
        },
      }
    }

    case 'query':
      // The answer (cmd.summary) is already fully computed by the local,
      // deterministic script in financialContext.ts — nothing to execute.
      return { ok: true, message: cmd.summary }

    case 'unrecognized':
    default:
      return { ok: false, message: cmd.summary }
  }
}
