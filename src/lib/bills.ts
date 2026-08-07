import type { RecurringBill } from '../db'
import { currentMonthKey, parseISODate, resolveDueDate } from './dates'

export interface UpcomingBill {
  bill: RecurringBill
  dueDate: Date
  /** Monthly bills: paid for the current month cycle (resets next month).
   * One-time bills: paid, full stop — there's no cycle to reset. */
  paidThisMonth: boolean
  overdue: boolean
}

export function getBillsThisMonth(
  bills: RecurringBill[],
  today: Date = new Date(),
): UpcomingBill[] {
  const monthKey = currentMonthKey(today)
  // Strip time-of-day so the overdue comparison is calendar-date-only.
  const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return bills
    .filter((b) => b.active)
    .map((bill) => {
      if (bill.frequency === 'once') {
        const dueDate = bill.dueDate ? parseISODate(bill.dueDate) : todayDateOnly
        const paid = bill.paid === true
        return { bill, dueDate, paidThisMonth: paid, overdue: !paid && todayDateOnly.getTime() > dueDate.getTime() }
      }
      const dueDate = resolveDueDate(bill.dueDay, today.getFullYear(), today.getMonth())
      const paidThisMonth = bill.lastPaidMonth === monthKey
      return {
        bill,
        dueDate,
        paidThisMonth,
        overdue: !paidThisMonth && todayDateOnly.getTime() > dueDate.getTime(),
      }
    })
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
      return a.dueDate.getTime() - b.dueDate.getTime()
    })
}

export function getUpcomingUnpaidBills(bills: RecurringBill[], today: Date = new Date()) {
  return getBillsThisMonth(bills, today).filter((b) => !b.paidThisMonth)
}
