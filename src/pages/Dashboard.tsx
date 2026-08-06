import { useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion, AnimatePresence } from 'framer-motion'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts'
import {
  TrendingUp,
  Plus,
  Wallet,
  PiggyBank,
  CalendarClock,
  AlertTriangle,
  Sparkles,
  Newspaper,
  ChevronDown,
} from 'lucide-react'
import db from '../db'
import PendingPayoutBanner from '../components/PendingPayoutBanner'
import AnimatedMoney from '../components/AnimatedMoney'
import Tile from '../components/Tile'
import Card from '../components/Card'
import { formatMoney, formatMonthLabel, formatWeekLabel } from '../lib/format'
import {
  netWorth,
  spentByCategoryThisMonth,
  spentByCategoryThisWeek,
  buildMonthlySeries,
  buildWeeklySeries,
} from '../lib/finance'
import { buildFinancialContext, composePersonalizedHighlight } from '../lib/financialContext'
import { detectUnusualSpend } from '../lib/anomalyDetection'
import { getUpcomingUnpaidBills } from '../lib/bills'
import { staggerContainer, fadeUpItem, collapseItem } from '../lib/motion'
import { generateMonthInReview, type MonthInReviewInput } from '../lib/monthInReview'
import type { AiTier } from '../lib/aiEngine'

type ChartPeriod = 'week' | 'month'

// Shared recharts <Tooltip> styling so the three inline charts get a small
// rounded/shadowed popover matching the app's Card conventions instead of
// recharts' plain default box.
const tooltipContentStyle: CSSProperties = {
  borderRadius: 12,
  border: '1px solid rgb(226 232 240)',
  boxShadow: '0 4px 12px -2px rgb(15 23 42 / 0.08)',
  fontSize: 12,
  padding: '6px 10px',
}
const tooltipWrapperStyle: CSSProperties = { outline: 'none' }

export default function Dashboard() {
  // Shared by the "spend by category" and "income vs expense" charts below;
  // "Net worth over time" is deliberately excluded from this toggle and
  // stays monthly-only.
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('month')

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

  // Reports & trends charts, relocated from the former /reports page —
  // data-building logic below is unchanged, just moved.
  const expenseCategories = (categories ?? []).filter((c) => c.kind === 'expense')
  const pieData = expenseCategories
    .map((c) => ({
      name: c.name,
      value:
        chartPeriod === 'week'
          ? spentByCategoryThisWeek(transactions ?? [], c.id)
          : spentByCategoryThisMonth(transactions ?? [], c.id),
      color: c.color,
    }))
    .filter((d) => d.value > 0)

  // Net worth trend is deliberately monthly-only, unaffected by chartPeriod.
  const netWorthSeries = loading ? [] : buildMonthlySeries(accounts, transactions, categoriesById, 6)
  const netWorthChartData = netWorthSeries.map((p) => ({
    month: formatMonthLabel(p.monthKey),
    'Net worth': p.netWorth,
  }))

  const incomeExpenseChartData = loading
    ? []
    : chartPeriod === 'week'
      ? buildWeeklySeries(accounts, transactions, categoriesById, 8).map((p) => ({
          period: formatWeekLabel(p.weekKey),
          Income: p.income,
          Expense: p.expense,
        }))
      : buildMonthlySeries(accounts, transactions, categoriesById, 6).map((p) => ({
          period: formatMonthLabel(p.monthKey),
          Income: p.income,
          Expense: p.expense,
        }))

  const monthInReviewInput: MonthInReviewInput = {
    transactions: transactions ?? [],
    categories: categories ?? [],
    budgets: budgets ?? [],
    accounts: accounts ?? [],
    transfers: transfers ?? [],
  }

  return (
    <div className="pb-4">
      <PendingPayoutBanner />

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="mx-4 mt-4 grid grid-flow-row-dense grid-cols-2 gap-3"
      >
        <Tile to="/accounts" tone="dark" variants={fadeUpItem} className="col-span-2">
          <div className="flex items-center gap-2 text-slate-300">
            <TrendingUp size={14} />
            <p className="text-xs uppercase tracking-wide">Net worth</p>
          </div>
          {loading ? (
            <p className="mt-1 text-3xl font-semibold">—</p>
          ) : (
            <AnimatedMoney value={worth} className="mt-1 block text-3xl font-semibold" />
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
            <p className="tabular-money text-lg font-semibold text-slate-800 dark:text-slate-200">
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
                ({ bill, dueDate, overdue }) => (
                  <li
                    key={bill.id}
                    className="min-w-0 rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60"
                  >
                    <p className="truncate min-w-0 text-slate-700 dark:text-slate-300">{bill.name}</p>
                    <p
                      className={`mt-0.5 text-xs ${
                        overdue ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {formatMoney(bill.amount)} · due{' '}
                      {dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {overdue && ' · Overdue'}
                    </p>
                  </li>
                ),
              )}
            </ul>
          )}
        </Tile>

        <MonthInReviewTile input={monthInReviewInput} />
      </motion.div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="mx-4 mt-3 space-y-3"
      >
        <Card tone="default" variants={fadeUpItem}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Spend by category (this {chartPeriod})
            </h2>
            <PeriodToggle
              period={chartPeriod}
              setPeriod={setChartPeriod}
              idPrefix="pie"
              label="Spend by category period"
            />
          </div>
          {pieData.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No expenses logged yet this {chartPeriod}.
            </p>
          ) : (
            <>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={38}
                      outerRadius={62}
                      animationDuration={700}
                      animationEasing="ease-out"
                    >
                      {pieData.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => formatMoney(Number(value))}
                      contentStyle={tooltipContentStyle}
                      wrapperStyle={tooltipWrapperStyle}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ChartLegend items={pieData.map((d) => ({ label: d.name, color: d.color }))} />
            </>
          )}
        </Card>

        <Card tone="default" variants={fadeUpItem}>
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            Net worth over time
          </h2>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={netWorthChartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="0"
                  className="stroke-slate-100 dark:stroke-slate-700/50"
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: 'currentColor' }}
                  className="text-slate-400 dark:text-slate-500"
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  formatter={(value) => formatMoney(Number(value))}
                  contentStyle={tooltipContentStyle}
                  wrapperStyle={tooltipWrapperStyle}
                />
                <Line
                  type="monotone"
                  dataKey="Net worth"
                  stroke="#4f46e5"
                  strokeWidth={1.5}
                  dot={false}
                  animationDuration={800}
                  animationEasing="ease-out"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card tone="default" variants={fadeUpItem}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Income vs expense by {chartPeriod}
            </h2>
            <PeriodToggle
              period={chartPeriod}
              setPeriod={setChartPeriod}
              idPrefix="bar"
              label="Income vs expense period"
            />
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={incomeExpenseChartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="0"
                  className="stroke-slate-100 dark:stroke-slate-700/50"
                />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 10, fill: 'currentColor' }}
                  className="text-slate-400 dark:text-slate-500"
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  formatter={(value) => formatMoney(Number(value))}
                  contentStyle={tooltipContentStyle}
                  wrapperStyle={tooltipWrapperStyle}
                />
                <Bar
                  dataKey="Income"
                  fill="#22c55e"
                  maxBarSize={18}
                  radius={[3, 3, 0, 0]}
                  animationDuration={700}
                  animationEasing="ease-out"
                />
                <Bar
                  dataKey="Expense"
                  fill="#ef4444"
                  maxBarSize={18}
                  radius={[3, 3, 0, 0]}
                  animationDuration={700}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartLegend items={[{ label: 'Income', color: '#22c55e' }, { label: 'Expense', color: '#ef4444' }]} />
        </Card>
      </motion.div>
    </div>
  )
}

/** Small inline chart legend (color dot + label), matching the color-dot
 * convention already used for categories elsewhere in the app (Budgets.tsx,
 * PickerGrid.tsx) rather than recharts' bulkier default <Legend>. */
function ChartLegend({ items }: { items: { label: string; color?: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
      {items.map((item) => (
        <span
          key={item.label}
          className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

/** Small Week/Month segmented pill, matching the kind toggle in
 * AddTransaction.tsx / Settings.tsx (pill container + sliding
 * `motion.span` indicator via layoutId). `idPrefix` keeps each instance's
 * layoutId independent so two toggles reflecting the same shared state
 * don't fight over one shared layout animation. */
function PeriodToggle({
  period,
  setPeriod,
  idPrefix,
  label,
}: {
  period: ChartPeriod
  setPeriod: (p: ChartPeriod) => void
  idPrefix: string
  label: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="relative flex shrink-0 gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
    >
      {(['week', 'month'] as ChartPeriod[]).map((p) => (
        <button
          type="button"
          key={p}
          onClick={() => setPeriod(p)}
          aria-pressed={period === p}
          className={`relative z-10 rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
            period === p ? 'text-white' : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          {period === p && (
            <motion.span
              layoutId={`${idPrefix}-period-pill`}
              className="absolute inset-0 -z-10 rounded-md bg-indigo-600"
              transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            />
          )}
          {p}
        </button>
      ))}
    </div>
  )
}

/** Expand-in-place recap tile, mirroring the account-history expand pattern
 * in Accounts.tsx (clickable header with a rotating chevron, AnimatePresence
 * + collapseItem for the panel). Collapsed by default with a short teaser;
 * on first expand it calls generateMonthInReview() (native AI / opt-in local
 * model / deterministic template, in that order) and caches the result so
 * re-collapsing/expanding doesn't refetch. */
function MonthInReviewTile({ input }: { input: MonthInReviewInput }) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ text: string; tier: AiTier } | null>(null)
  const [error, setError] = useState(false)

  async function loadReview() {
    setLoading(true)
    setError(false)
    try {
      const review = await generateMonthInReview(input)
      setResult(review)
    } catch {
      // generateNarrative() already guarantees a template fallback and never
      // throws, but buildMonthInReviewFallback's own inputs are technically
      // caller-controlled — keep a defensive error state so a tap never just
      // hangs or silently shows nothing if something upstream misbehaves.
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  function toggle() {
    const next = !expanded
    setExpanded(next)
    if (next && !result && !loading) {
      loadReview()
    }
  }

  return (
    <Card variants={fadeUpItem} layout className={`overflow-hidden !p-0 ${expanded ? 'col-span-2' : 'col-span-1'}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle()
          }
        }}
        className="flex w-full cursor-pointer flex-col gap-2 px-4 py-3 text-left"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Newspaper size={16} />
            <p className="text-xs font-semibold uppercase tracking-wide">Month in review</p>
          </div>
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown size={16} className="text-slate-400" />
          </motion.div>
        </div>
        {!expanded && <p className="text-sm text-slate-500 dark:text-slate-400">Tap for your month in review</p>}
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            variants={collapseItem}
            initial="hidden"
            animate="show"
            exit="exit"
            className="border-t border-slate-100 px-4 dark:border-slate-700/60"
          >
            <div className="py-3">
              {loading && (
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <div
                    className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600 dark:border-slate-700 dark:border-t-indigo-400"
                    role="status"
                    aria-label="Loading"
                  />
                  Putting together your recap…
                </div>
              )}
              {!loading && error && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-slate-500 dark:text-slate-400" role="alert">
                    Couldn't put together a recap right now.
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      loadReview()
                    }}
                    className="shrink-0 text-sm font-medium text-indigo-600 dark:text-indigo-400"
                  >
                    Retry
                  </button>
                </div>
              )}
              {!loading && !error && result && (
                <div className="space-y-2">
                  <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{result.text}</p>
                  {result.tier !== 'template' && (
                    <span className="inline-flex shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      AI-enhanced
                    </span>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}
