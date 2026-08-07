import type { Account, Category, Transaction } from '../db'
import { formatTime } from './format'

function csvField(value: string | number): string {
  const str = String(value)
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

/** A plain CSV of every transaction (not transfers between your own
 * accounts — those aren't income or expense, so they'd just be noise for
 * spreadsheet/tax use) for opening outside the app. Sorted oldest first,
 * matching how a bank statement reads. Alongside exportBackup()'s JSON,
 * which is for restoring into this app, not for reading elsewhere. */
export function buildTransactionsCsv(
  transactions: Transaction[],
  accountsById: Map<number, Account>,
  categoriesById: Map<number, Category>,
): string {
  const header = ['Date', 'Time', 'Account', 'Category', 'Type', 'Amount', 'Note']
  const rows = transactions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map((t) => {
      const account = accountsById.get(t.accountId)
      const category = categoriesById.get(t.categoryId)
      return [
        t.date,
        formatTime(t.createdAt),
        account?.name ?? 'Unknown account',
        category?.name ?? 'Unknown category',
        category?.kind ?? '',
        t.amount.toFixed(2),
        t.note,
      ]
    })

  return [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n')
}
