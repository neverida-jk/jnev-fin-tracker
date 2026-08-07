import type { Category, RecurringBill, Transaction } from '../db'
import { parseISODate, todayISO } from './dates'

export interface SubscriptionCandidate {
  key: string // `${categoryId}:${amount}` — stable id for dismissal and React keys
  categoryId: number
  accountId: number
  amount: number
  occurrences: string[] // ISO dates, oldest first
}

const MIN_OCCURRENCES = 3
// A real monthly charge lands roughly a calendar month apart — wide enough
// to cover 28-31 day months and a few days of billing-date drift, narrow
// enough that weekly/biweekly spending (e.g. groceries) can't qualify even
// if the amount happens to repeat by coincidence.
const MIN_DAYS_BETWEEN = 25
const MAX_DAYS_BETWEEN = 35
// If the pattern hasn't recurred in this long, it's stopped — not "still a
// subscription" (canceled, or a coincidence that ran its course).
const MAX_DAYS_SINCE_LAST = 40

function daysBetween(isoA: string, isoB: string): number {
  return Math.round((parseISODate(isoB).getTime() - parseISODate(isoA).getTime()) / (1000 * 60 * 60 * 24))
}

/** Finds expense transactions that repeat at the same amount, in the same
 * category, roughly once a month — the shape of a subscription or other
 * recurring charge that was never set up as a tracked bill. Naive fixed-
 * amount-match heuristic: a subscription whose price changed (e.g. a promo
 * ending) won't be recognized as the same series. */
export function detectSubscriptionCandidates(
  transactions: Transaction[],
  categories: Category[],
  bills: RecurringBill[],
  today: Date = new Date(),
): SubscriptionCandidate[] {
  const expenseCategoryIds = new Set(categories.filter((c) => c.kind === 'expense').map((c) => c.id))
  const alreadyTracked = new Set(bills.filter((b) => b.active).map((b) => `${b.categoryId}:${b.amount}`))
  const todayKey = todayISO(today)

  const groups = new Map<string, Transaction[]>()
  for (const t of transactions) {
    if (!expenseCategoryIds.has(t.categoryId)) continue
    const key = `${t.categoryId}:${t.amount}`
    if (alreadyTracked.has(key)) continue
    const list = groups.get(key) ?? []
    list.push(t)
    groups.set(key, list)
  }

  const candidates: SubscriptionCandidate[] = []
  for (const [key, txs] of groups) {
    if (txs.length < MIN_OCCURRENCES) continue
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date))

    const regular = sorted.every((t, i) => {
      if (i === 0) return true
      const gap = daysBetween(sorted[i - 1].date, t.date)
      return gap >= MIN_DAYS_BETWEEN && gap <= MAX_DAYS_BETWEEN
    })
    if (!regular) continue

    const last = sorted[sorted.length - 1]
    if (daysBetween(last.date, todayKey) > MAX_DAYS_SINCE_LAST) continue

    candidates.push({
      key,
      categoryId: last.categoryId,
      accountId: last.accountId,
      amount: last.amount,
      occurrences: sorted.map((t) => t.date),
    })
  }

  return candidates.sort((a, b) => b.occurrences.length - a.occurrences.length)
}

const DISMISSED_KEY = 'subscription-detection-dismissed'

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

export function isSubscriptionCandidateDismissed(key: string): boolean {
  return readDismissed().has(key)
}

/** Dismissing is permanent per (category, amount) pair, not per-occurrence —
 * if it's genuinely not a bill worth tracking, it shouldn't keep asking
 * every month the pattern repeats. */
export function dismissSubscriptionCandidate(key: string): void {
  const dismissed = readDismissed()
  dismissed.add(key)
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]))
  } catch {
    // best-effort only — worst case it asks again next time
  }
}
