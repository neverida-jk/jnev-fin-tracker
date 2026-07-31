import type { PayoutDate, PayoutSchedule } from '../db'
import { todayISO } from './dates'

export interface PendingPayout {
  payoutDate: PayoutDate
  schedule: PayoutSchedule
}

/** A payout date is "pending" once it has arrived and hasn't been logged yet —
 * this drives the nag banner. */
export function getPendingPayoutDates(
  schedules: PayoutSchedule[],
  payoutDates: PayoutDate[],
  today: Date = new Date(),
): PendingPayout[] {
  const activeSchedulesById = new Map(schedules.filter((s) => s.active).map((s) => [s.id, s]))
  const todayKey = todayISO(today)

  return payoutDates
    .filter((pd) => !pd.loggedTransactionId && pd.date <= todayKey && activeSchedulesById.has(pd.scheduleId))
    .map((pd) => ({ payoutDate: pd, schedule: activeSchedulesById.get(pd.scheduleId)! }))
    .sort((a, b) => a.payoutDate.date.localeCompare(b.payoutDate.date))
}

/** The single next pending payout to fulfill (earliest due date), or
 * `undefined` if there isn't one — used by "log payout ..." to find the
 * specific PayoutDate a logged amount should be tied to. */
export function getNextPendingPayout(
  schedules: PayoutSchedule[],
  payoutDates: PayoutDate[],
  today: Date = new Date(),
): PendingPayout | undefined {
  return getPendingPayoutDates(schedules, payoutDates, today)[0]
}
