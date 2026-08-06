import { useLiveQuery } from 'dexie-react-hooks'
import db from '../db'
import { netWorth } from '../lib/finance'
import { getNextPendingPayout } from '../lib/payout'
import { formatMoney } from '../lib/format'
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
  const payoutSchedules = useLiveQuery(() => db.payoutSchedules.toArray(), [], [])
  const payoutDates = useLiveQuery(() => db.payoutDates.toArray(), [], [])

  const loading = !accounts || !transactions || !categories

  const categoriesById = new Map((categories ?? []).map((c) => [c.id, c]))
  const worth = loading ? 0 : netWorth(accounts, transactions, transfers ?? [], categoriesById)

  const nextPayout = getNextPendingPayout(payoutSchedules ?? [], payoutDates ?? [])
  const payoutText = nextPayout ? payoutPhrase(daysUntil(nextPayout.payoutDate.date)) : null

  const summary = loading
    ? 'Loading…'
    : payoutText
      ? `Net worth ${formatMoney(worth)} · ${payoutText}`
      : `Net worth ${formatMoney(worth)}`

  return (
    <div className="shrink-0 border-t border-slate-200/70 bg-white/80 px-4 py-2 backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-900/80">
      {/* pr-20 keeps text clear of the Quick Command FAB (h-12 button at
          bottom-6 right-4), so the strip never overlaps or competes with it. */}
      <p className="truncate pr-20 text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">
        {summary}
      </p>
    </div>
  )
}
