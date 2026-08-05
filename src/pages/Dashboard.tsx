import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { TrendingUp, Plus, Wallet, PiggyBank, CalendarClock, BarChart3, AlertTriangle, Sparkles } from 'lucide-react'
import db from '../db'
import PendingPayoutBanner from '../components/PendingPayoutBanner'
import AnimatedMoney from '../components/AnimatedMoney'
import Tile from '../components/Tile'
import { formatMoney } from '../lib/format'
import { netWorth, spentByCategoryThisMonth, buildMonthlySeries } from '../lib/finance'
import { buildFinancialContext, composePersonalizedHighlight } from '../lib/financialContext'
import { detectUnusualSpend } from '../lib/anomalyDetection'
import { getUpcomingUnpaidBills } from '../lib/bills'
import { staggerContainer, fadeUpItem } from '../lib/motion'

export default function Dashboard() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], [])
  const transfers = useLiveQuery(() => db.transfers.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], [])
  const bills = useLiveQuery(() => db.recurringBills.toArray(), [], [])

  const loading = !accounts || !transactions || !categories || !budgets || !bills
  const categoriesById = new Map((categories ?? []).map((c) => [c.id, c]))

  const worth = loading ? 0 : netWorth(accounts, transactions, transfers ?? [], categoriesById)
  const upcomingBills = loading ? [] : getUpcomingUnpaidBills(bills).slice(0, 3)
  const topBudgets = (budgets ?? []).slice(0, 2)
  const nextBill = upcomingBills[0]

  // Anomaly is more actionable than a generic personalized highlight, so it
  // takes priority when both have something to say; if neither does (e.g. a
  // brand-new install with no history), insightMessage stays null and the
  // net worth tile shows nothing extra.
  const anomalies = loading ? [] : detectUnusualSpend(transactions, categories)
  const monthlySeries = loading ? [] : buildMonthlySeries(accounts, transactions, categoriesById, 2)
  const financialContext = loading
    ? null
    : buildFinancialContext(accounts, categories, transactions, transfers ?? [], budgets ?? [])
  const personalizedHighlight = financialContext
    ? composePersonalizedHighlight(financialContext, monthlySeries)
    : null
  const isAnomaly = anomalies.length > 0
  const insightMessage = anomalies[0]?.message ?? personalizedHighlight ?? null

  const budgetsSpan = (budgets?.length ?? 0) > 0 ? 'col-span-2' : 'col-span-1'
  const billsSpan = upcomingBills.length > 1 ? 'col-span-2' : 'col-span-1'

  return (
    <div className="pb-4">
      <PendingPayoutBanner />

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="mx-4 mt-4 grid grid-flow-row-dense grid-cols-2 gap-3"
      >
        <Tile to="/reports" tone="dark" variants={fadeUpItem} className="col-span-2">
          <div className="flex items-center gap-2 text-slate-300">
            <TrendingUp size={14} />
            <p className="text-xs uppercase tracking-wide">Net worth</p>
          </div>
          {loading ? (
            <p className="mt-1 text-3xl font-semibold">—</p>
          ) : (
            <AnimatedMoney value={worth} className="mt-1 block text-3xl font-semibold tabular-nums" />
          )}
          {insightMessage && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-300">
              {isAnomaly ? (
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
              ) : (
                <Sparkles size={13} className="mt-0.5 shrink-0 text-slate-400" />
              )}
              <span>{insightMessage}</span>
            </p>
          )}
        </Tile>

        <Tile to="/add" tone="solid" variants={fadeUpItem} className="col-span-1 items-start justify-between">
          <Plus size={22} />
          <p className="mt-6 text-sm font-semibold">Add transaction</p>
        </Tile>

        <Tile to="/accounts" variants={fadeUpItem} className="col-span-1 justify-between">
          <Wallet size={20} className="text-indigo-500" />
          <div className="mt-6">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {loading ? '—' : `${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
            </p>
            <p className="text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-200">
              {loading ? '—' : formatMoney(worth)}
            </p>
          </div>
        </Tile>

        <Tile to="/budgets" variants={fadeUpItem} className={budgetsSpan}>
          <div className="mb-2 flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <PiggyBank size={16} />
            <p className="text-xs font-semibold uppercase tracking-wide">Budgets</p>
          </div>
          {topBudgets.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Tap to set a monthly budget.</p>
          ) : (
            <div className="space-y-3">
              {topBudgets.map((budget) => {
                const category = categoriesById.get(budget.categoryId)
                const spent = spentByCategoryThisMonth(transactions ?? [], budget.categoryId)
                const pct =
                  budget.monthlyLimit > 0 ? Math.min(100, (spent / budget.monthlyLimit) * 100) : 0
                const over = spent > budget.monthlyLimit
                return (
                  <div key={budget.id}>
                    <div className="flex justify-between text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: category?.color }}
                        />
                        {category?.name ?? 'Unknown'}
                      </span>
                      <span
                        className={
                          over ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'
                        }
                      >
                        {formatMoney(spent)} / {formatMoney(budget.monthlyLimit)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700/60">
                      <motion.div
                        className={`h-2 rounded-full ${over ? 'bg-red-500' : 'bg-indigo-500'}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Tile>

        <Tile to="/bills" variants={fadeUpItem} className={billsSpan}>
          <div className="mb-2 flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <CalendarClock size={16} />
            <p className="text-xs font-semibold uppercase tracking-wide">Upcoming bills</p>
          </div>
          {upcomingBills.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing due soon.</p>
          ) : (
            <ul className="space-y-2">
              {(billsSpan === 'col-span-2' ? upcomingBills : nextBill ? [nextBill] : []).map(
                ({ bill, dueDate }) => (
                  <li
                    key={bill.id}
                    className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60"
                  >
                    <span className="text-slate-700 dark:text-slate-300">{bill.name}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {formatMoney(bill.amount)} ·{' '}
                      {dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </li>
                ),
              )}
            </ul>
          )}
        </Tile>

        <Tile to="/reports" variants={fadeUpItem} className="col-span-1 justify-between">
          <BarChart3 size={20} className="text-indigo-500" />
          <p className="mt-6 text-sm font-semibold text-slate-800 dark:text-slate-200">
            Reports & trends
          </p>
        </Tile>
      </motion.div>
    </div>
  )
}
