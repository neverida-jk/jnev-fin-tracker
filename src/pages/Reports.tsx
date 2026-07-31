import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
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
  Legend,
} from 'recharts'
import db from '../db'
import { buildMonthlySeries, spentByCategoryThisMonth } from '../lib/finance'
import { formatMoney, formatMonthLabel } from '../lib/format'
import Card from '../components/Card'
import { staggerContainer, fadeUpItem } from '../lib/motion'

export default function Reports() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])

  const loading = !accounts || !transactions || !categories
  const categoriesById = new Map((categories ?? []).map((c) => [c.id, c]))

  const expenseCategories = (categories ?? []).filter((c) => c.kind === 'expense')
  const pieData = expenseCategories
    .map((c) => ({
      name: c.name,
      value: spentByCategoryThisMonth(transactions ?? [], c.id),
      color: c.color,
    }))
    .filter((d) => d.value > 0)

  const series = loading ? [] : buildMonthlySeries(accounts, transactions, categoriesById, 6)
  const chartData = series.map((p) => ({
    month: formatMonthLabel(p.monthKey),
    Income: p.income,
    Expense: p.expense,
    'Net worth': p.netWorth,
  }))

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="mx-4 mt-4 space-y-5 pb-6"
    >
      <Card variants={fadeUpItem}>
        <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          Spend by category (this month)
        </h2>
        {pieData.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No expenses logged yet this month.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  animationDuration={700}
                  animationEasing="ease-out"
                >
                  {pieData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card variants={fadeUpItem}>
        <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          Net worth over time
        </h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={60} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Line
                type="monotone"
                dataKey="Net worth"
                stroke="#4f46e5"
                strokeWidth={2}
                dot={false}
                animationDuration={800}
                animationEasing="ease-out"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card variants={fadeUpItem}>
        <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          Income vs expense by month
        </h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={60} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Legend />
              <Bar dataKey="Income" fill="#22c55e" animationDuration={700} animationEasing="ease-out" />
              <Bar dataKey="Expense" fill="#ef4444" animationDuration={700} animationEasing="ease-out" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </motion.div>
  )
}
