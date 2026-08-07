import type { PayoutDate, PayoutSchedule, RecurringBill } from '../db'
import { getPendingPayoutDates } from './payout'
import { getUpcomingUnpaidBills } from './bills'
import { formatMoney } from './format'
import { todayISO } from './dates'

const LAST_CHECKED_KEY = 'notifications-last-checked-date'

export type NotificationStatus = NotificationPermission | 'unsupported'

export function isNotificationSupported(): boolean {
  return typeof Notification !== 'undefined'
}

export function getNotificationPermission(): NotificationStatus {
  if (!isNotificationSupported()) return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<NotificationStatus> {
  if (!isNotificationSupported()) return 'unsupported'
  return Notification.requestPermission()
}

/** Prefers showing through the service worker (works better for an installed
 * PWA, and required on some browsers when the tab isn't focused); falls back
 * to the plain constructor if there's no active service worker. Either path
 * failing just means no notification — never worth crashing over. */
async function fireNotification(title: string, body: string, tag: string): Promise<void> {
  if (!isNotificationSupported()) return
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const registration = await navigator.serviceWorker.ready
      await registration.showNotification(title, { body, tag })
      return
    }
  } catch {
    // fall through to the plain constructor
  }
  try {
    new Notification(title, { body, tag })
  } catch {
    // e.g. no permission, or a browser that requires a service worker — nothing more to do
  }
}

/** Reminds about bills due today/tomorrow (or overdue) and any pending
 * payout — at most once per calendar day, tracked via localStorage. This
 * only ever runs while the app is open/foregrounded: a PWA with no push
 * server can't wake up in the background on its own, so this is a "remind
 * me when I check in" nudge, not a guaranteed background alert. */
export async function checkAndNotify(
  bills: RecurringBill[],
  schedules: PayoutSchedule[],
  payoutDates: PayoutDate[],
  today: Date = new Date(),
): Promise<void> {
  if (getNotificationPermission() !== 'granted') return

  const todayKey = todayISO(today)
  let lastChecked: string | null
  try {
    lastChecked = localStorage.getItem(LAST_CHECKED_KEY)
  } catch {
    return
  }
  if (lastChecked === todayKey) return

  const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dueSoon = getUpcomingUnpaidBills(bills, today).filter((b) => {
    const daysUntil = Math.round((b.dueDate.getTime() - todayDateOnly.getTime()) / (1000 * 60 * 60 * 24))
    return b.overdue || daysUntil <= 1
  })
  for (const b of dueSoon) {
    await fireNotification(
      b.overdue ? `${b.bill.name} is overdue` : `${b.bill.name} is due soon`,
      `${formatMoney(b.bill.amount)} — log it in the app when you pay.`,
      `bill-${b.bill.id}`,
    )
  }

  for (const p of getPendingPayoutDates(schedules, payoutDates, today)) {
    await fireNotification(
      `${p.schedule.label} payout is here`,
      'Log the amount when you get a chance.',
      `payout-${p.payoutDate.id}`,
    )
  }

  try {
    localStorage.setItem(LAST_CHECKED_KEY, todayKey)
  } catch {
    // best-effort only — worst case it re-checks (and re-notifies) next open
  }
}
