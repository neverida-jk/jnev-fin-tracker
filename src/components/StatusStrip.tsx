import { useLiveQuery } from 'dexie-react-hooks'
import { Gauge } from 'lucide-react'
import db from '../db'
import { buildFinancialContext, composeSuggestedSavings } from '../lib/financialContext'
import { getNextPendingPayout } from '../lib/payout'
import { parseISODate, todayISO } from '../lib/dates'

const MS_PER_DAY = 1000 * 60 * 60 * 24

function daysUntil(dateISO: string, today: Date = new Date()): number {
  const target = parseISODate(dateISO)
  const start = parseISODate(todayISO(today))
  return Math.round((target.getTime() - start.getTime()) / MS_PER_DAY)
}

// getNextPendingPayout only ever returns a payout whose date has already
// arrived and hasn't been logged yet (see payout.ts), so `days` here is
// normally <= 0 — phrase it accordingly rather than assuming a future date.
function payoutPhrase(days: number): string {
  if (days > 0) return `payday in ${days} day${days === 1 ? '' : 's'}`
  if (days === 0) return 'payday today'
  return 'payout pending'
}

/** Thin, always-visible status bar shown below the routed page content on
 * every screen — a quiet anchor for the bottom edge now that the tab bar is
 * gone. Deliberately low-contrast so it never competes with page content or
 * the Quick Command FAB, which floats over its bottom-right corner. */
export default function StatusStrip() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], [])
  const transfers = useLiveQuery(() => db.transfers.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], [])
  const payoutSchedules = useLiveQuery(() => db.payoutSchedules.toArray(), [], [])
  const payoutDates = useLiveQuery(() => db.payoutDates.toArray(), [], [])

  const loading = !accounts || !transactions || !transfers || !categories || !budgets

  // accounts/transfers are needed now too — savedThisMonth reflects real
  // transfers into savings-type accounts, not just unspent income.
  const savingsText = loading
    ? null
    : composeSuggestedSavings(buildFinancialContext(accounts, categories, transactions, transfers, budgets))

  const nextPayout = getNextPendingPayout(payoutSchedules ?? [], payoutDates ?? [])
  const payoutText = nextPayout ? payoutPhrase(daysUntil(nextPayout.payoutDate.date)) : null

  const summary = loading
    ? 'Loading…'
    : payoutText
      ? `${savingsText} · ${payoutText}`
      : savingsText

  return (
    <div className="shrink-0 border-t border-slate-200/70 bg-white/80 px-4 py-2 backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-900/80">
      {/* pr-20 keeps text clear of the Quick Command FAB (h-12 button at
          bottom-6 right-4), so the strip never overlaps or competes with it. */}
      <p className="flex items-center gap-1 truncate pr-20 text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">
        <Gauge className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{summary}</span>
      </p>
    </div>
  )
}
