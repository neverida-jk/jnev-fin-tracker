import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X } from 'lucide-react'
import db, { type Transaction } from '../db'
import { signedAmount } from '../lib/finance'
import { formatMoney } from '../lib/format'
import { parseISODate } from '../lib/dates'
import Card from '../components/Card'
import { staggerContainer, fadeUpItem } from '../lib/motion'
import { TransactionEditForm } from './Accounts'

interface HistoryRow {
  id: string
  date: string
  kind: 'transaction' | 'transfer'
  label: string
  accountLabel: string
  categoryColor?: string
  categoryId?: number
  accountIds: number[]
  signed: number
  amount: number
  transaction?: Transaction
  searchText: string
}

/** Every transaction and transfer across every account, newest first —
 * unlike Accounts.tsx's per-account history (capped at 20, one account at a
 * time), this is the single place to search/filter the full ledger. Reuses
 * TransactionEditForm from Accounts.tsx rather than duplicating the edit UI;
 * transfers stay read-only here too, matching that page's behavior. */
export default function Transactions() {
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], [])
  const transfers = useLiveQuery(() => db.transfers.toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])

  const accountsById = new Map((accounts ?? []).map((a) => [a.id, a]))
  const categoriesById = new Map((categories ?? []).map((c) => [c.id, c]))

  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null)
  const [accountFilter, setAccountFilter] = useState<number | null>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [editingTxId, setEditingTxId] = useState<number | null>(null)

  const rows: HistoryRow[] = [
    ...(transactions ?? []).map((t): HistoryRow => {
      const category = categoriesById.get(t.categoryId)
      const account = accountsById.get(t.accountId)
      const label = `${category?.name ?? 'Unknown'}${t.note ? ` · ${t.note}` : ''}`
      const accountLabel = account?.name ?? 'Unknown account'
      return {
        id: `t${t.id}`,
        date: t.date,
        kind: 'transaction',
        label,
        accountLabel,
        categoryColor: category?.color,
        categoryId: t.categoryId,
        accountIds: [t.accountId],
        signed: category ? signedAmount(t.amount, category.kind) : t.amount,
        amount: t.amount,
        transaction: t,
        searchText: `${label} ${accountLabel}`.toLowerCase(),
      }
    }),
    ...(transfers ?? []).map((tr) => {
      const fromName = accountsById.get(tr.fromAccountId)?.name ?? 'Unknown'
      const toName = accountsById.get(tr.toAccountId)?.name ?? 'Unknown'
      const label = `Transfer${tr.note ? ` · ${tr.note}` : ''}`
      const accountLabel = `${fromName} → ${toName}`
      const row: HistoryRow = {
        id: `x${tr.id}`,
        date: tr.date,
        kind: 'transfer',
        label,
        accountLabel,
        accountIds: [tr.fromAccountId, tr.toAccountId],
        signed: 0,
        amount: tr.amount,
        searchText: `${label} ${accountLabel}`.toLowerCase(),
      }
      return row
    }),
  ].sort((a, b) => b.date.localeCompare(a.date))

  const filtered = rows.filter((r) => {
    if (categoryFilter !== null && r.categoryId !== categoryFilter) return false
    if (accountFilter !== null && !r.accountIds.includes(accountFilter)) return false
    if (fromDate && r.date < fromDate) return false
    if (toDate && r.date > toDate) return false
    if (query.trim() && !r.searchText.includes(query.trim().toLowerCase())) return false
    return true
  })

  const totalSpent = filtered.filter((r) => r.signed < 0).reduce((sum, r) => sum + Math.abs(r.signed), 0)
  const hasActiveFilter = query.trim() !== '' || categoryFilter !== null || accountFilter !== null || fromDate !== '' || toDate !== ''

  const expenseCategories = (categories ?? []).filter((c) => c.kind === 'expense' && !c.archived)
  const incomeCategories = (categories ?? []).filter((c) => c.kind === 'income' && !c.archived)

  function clearFilters() {
    setQuery('')
    setCategoryFilter(null)
    setAccountFilter(null)
    setFromDate('')
    setToDate('')
  }

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="mx-4 mt-4 space-y-3 pb-6">
      <Card variants={fadeUpItem} className="space-y-3">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes, categories, accounts..."
            className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
          />
        </div>

        <div className="flex gap-2">
          <label className="flex-1 text-xs text-slate-500 dark:text-slate-400">
            From
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
          <label className="flex-1 text-xs text-slate-500 dark:text-slate-400">
            To
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
        </div>

        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <FilterChip label="All accounts" active={accountFilter === null} onClick={() => setAccountFilter(null)} />
          {(accounts ?? []).map((a) => (
            <FilterChip key={a.id} label={a.name} active={accountFilter === a.id} onClick={() => setAccountFilter(a.id)} />
          ))}
        </div>

        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <FilterChip label="All categories" active={categoryFilter === null} onClick={() => setCategoryFilter(null)} />
          {[...expenseCategories, ...incomeCategories].map((c) => (
            <FilterChip
              key={c.id}
              label={c.name}
              dotColor={c.color}
              active={categoryFilter === c.id}
              onClick={() => setCategoryFilter(c.id)}
            />
          ))}
        </div>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400"
          >
            <X size={12} /> Clear filters
          </button>
        )}
      </Card>

      <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
        {filtered.length} result{filtered.length === 1 ? '' : 's'}
        {totalSpent > 0 && ` · ${formatMoney(totalSpent)} spent`}
      </p>

      <Card variants={fadeUpItem} className="!p-0">
        {filtered.length === 0 ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">No transactions match these filters.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            <AnimatePresence initial={false}>
              {filtered.map((r) => (
                <motion.li
                  key={r.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="px-4 text-sm"
                >
                  {r.kind === 'transaction' && r.transaction && editingTxId === r.transaction.id ? (
                    <TransactionEditForm
                      transaction={r.transaction}
                      categories={categories ?? []}
                      onClose={() => setEditingTxId(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={r.kind !== 'transaction'}
                      onClick={() => r.transaction && setEditingTxId(r.transaction.id)}
                      className={`flex w-full items-center gap-2.5 py-2.5 text-left ${r.kind === 'transaction' ? '' : 'cursor-default'}`}
                    >
                      {r.categoryColor ? (
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.categoryColor }} />
                      ) : (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                        <span className="text-slate-400 dark:text-slate-500">
                          {parseISODate(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>{' '}
                        · {r.label}
                        <span className="block truncate text-xs text-slate-400 dark:text-slate-500">{r.accountLabel}</span>
                      </span>
                      {r.kind === 'transaction' ? (
                        <span
                          className={
                            r.signed < 0
                              ? 'tabular-money shrink-0 text-red-600 dark:text-red-400'
                              : 'tabular-money shrink-0 text-green-600 dark:text-green-400'
                          }
                        >
                          {r.signed < 0 ? '-' : '+'}
                          {formatMoney(Math.abs(r.signed))}
                        </span>
                      ) : (
                        <span className="tabular-money shrink-0 text-slate-400 dark:text-slate-500">
                          {formatMoney(r.amount)}
                        </span>
                      )}
                    </button>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Card>
    </motion.div>
  )
}

function FilterChip({
  label,
  active,
  dotColor,
  onClick,
}: {
  label: string
  active: boolean
  dotColor?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap ${
        active
          ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-500/10 dark:text-indigo-300'
          : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
      }`}
    >
      {dotColor && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dotColor }} />}
      {label}
    </button>
  )
}
