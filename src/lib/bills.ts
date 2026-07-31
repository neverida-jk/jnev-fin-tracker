import type { RecurringBill } from '../db'
import { currentMonthKey, resolveDueDate } from './dates'

export interface UpcomingBill {
  bill: RecurringBill
  dueDate: Date
  paidThisMonth: boolean
}

export function getBillsThisMonth(
  bills: RecurringBill[],
  today: Date = new Date(),
): UpcomingBill[] {
  const monthKey = currentMonthKey(today)
  return bills
    .filter((b) => b.active)
    .map((bill) => ({
      bill,
      dueDate: resolveDueDate(bill.dueDay, today.getFullYear(), today.getMonth()),
      paidThisMonth: bill.lastPaidMonth === monthKey,
    }))
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
}

export function getUpcomingUnpaidBills(bills: RecurringBill[], today: Date = new Date()) {
  return getBillsThisMonth(bills, today).filter((b) => !b.paidThisMonth)
}
