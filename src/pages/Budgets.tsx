import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Trash2, ChevronLeft, Check } from 'lucide-react'
import db, { type Category, type Transaction } from '../db'
import { spentByCategoryThisMonth } from '../lib/finance'
import { formatMoney } from '../lib/format'
import { recommendBudget } from '../lib/budgetRecommendation'
import type { AiTier } from '../lib/aiEngine'
import Card from '../components/Card'
import FlowStep from '../components/FlowStep'
import StepDots from '../components/StepDots'
import PickerGrid from '../components/PickerGrid'
import { staggerContainer, fadeUpItem, tapScale } from '../lib/motion'

export default function Budgets() {
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], [])
  const categoriesById = new Map((categories ?? []).map((c) => [c.id, c]))

  const budgetedCategoryIds = new Set((budgets ?? []).map((b) => b.categoryId))
  // Only offer non-archived, non-system expense categories that don't already
  // have a budget when starting a NEW budget. Existing budget rows above are
  // rendered straight from categoriesById and are unaffected, so a budget
  // whose category later gets archived keeps showing normally.
  const availableCategories = (categories ?? []).filter(
    (c) => c.kind === 'expense' && !c.system && !c.archived && !budgetedCategoryIds.has(c.id),
  )

  async function updateLimit(id: number, value: string) {
    const monthlyLimit = Number(value)
    if (Number.isNaN(monthlyLimit)) return
    await db.budgets.update(id, { monthlyLimit })
  }

  async function removeBudget(id: number) {
    await db.budgets.delete(id)
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="mx-4 mt-4 grid grid-flow-row-dense grid-cols-2 gap-3 pb-6"
    >
      <AnimatePresence initial={false}>
        {(budgets ?? []).map((budget) => {
          const category = categoriesById.get(budget.categoryId)
          const spent = spentByCategoryThisMonth(transactions ?? [], budget.categoryId)
          const pct = budget.monthlyLimit > 0 ? Math.min(100, (spent / budget.monthlyLimit) * 100) : 0
          const over = spent > budget.monthlyLimit
          return (
            <Card
              key={budget.id}
              layout
              variants={fadeUpItem}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
              className="col-span-1"
            >
              <div className="mb-2 flex items-center justify-between gap-1">
                <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-slate-800 dark:text-slate-200">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: category?.color }}
                  />
                  <span className="truncate">{category?.name ?? 'Unknown'}</span>
                </span>
                <motion.button
                  whileTap={{ scale: 0.85 }}
                  onClick={() => removeBudget(budget.id)}
                  aria-label="Remove budget"
                  className="shrink-0"
                >
                  <Trash2 size={14} className="text-slate-400" />
                </motion.button>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700/60">
                <motion.div
                  className={`h-2 rounded-full ${over ? 'bg-red-500' : 'bg-indigo-500'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <p
                className={`mt-2 text-xs ${over ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}
              >
                <span className="tabular-money">{formatMoney(spent)}</span> spent
              </p>
              <input
                type="number"
                step="0.01"
                defaultValue={budget.monthlyLimit}
                onBlur={(e) => updateLimit(budget.id, e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-1 text-sm tabular-money transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
              />
            </Card>
          )
        })}
      </AnimatePresence>

      {availableCategories.length > 0 && (
        <AddBudgetFlow categories={availableCategories} transactions={transactions ?? []} />
      )}
    </motion.div>
  )
}

function AddBudgetFlow({
  categories,
  transactions,
}: {
  categories: Category[]
  transactions: Transaction[]
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [limit, setLimit] = useState('')
  const [saved, setSaved] = useState(false)
  const [recommendation, setRecommendation] = useState<{
    suggestedAmount: number | null
    reason: string
    tier: AiTier
  } | null>(null)
  const [recommendationLoading, setRecommendationLoading] = useState(false)

  const category = categories.find((c) => c.id === categoryId)

  // Fetches a budget suggestion for the newly-chosen category as soon as it's
  // picked, so it's ready (or already loading) by the time the limit step is
  // shown. Depends on the `category` object itself (stable by reference
  // across re-renders as long as the underlying record hasn't changed) and
  // `transactions` rather than `categoryId` alone, so a real change in either
  // — not just a re-render of the parent's filtered category list — is what
  // triggers a refetch.
  useEffect(() => {
    if (!category) {
      setRecommendation(null)
      setRecommendationLoading(false)
      return
    }

    let cancelled = false
    setRecommendation(null)
    setRecommendationLoading(true)

    recommendBudget(category, transactions)
      .then((result) => {
        if (!cancelled) setRecommendation(result)
      })
      .finally(() => {
        if (!cancelled) setRecommendationLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [category, transactions])

  function openFlow() {
    setStep(0)
    setDirection(1)
    setCategoryId('')
    setLimit('')
    setSaved(false)
    setRecommendation(null)
    setRecommendationLoading(false)
    setOpen(true)
  }

  function goNext() {
    setDirection(1)
    setStep((s) => s + 1)
  }
  function goBack() {
    setDirection(-1)
    setStep((s) => Math.max(0, s - 1))
  }

  async function save() {
    const numericLimit = Number(limit)
    if (categoryId === '' || !numericLimit || numericLimit <= 0) return
    await db.budgets.add({
      id: undefined as unknown as number,
      categoryId,
      monthlyLimit: numericLimit,
    })
    setSaved(true)
    setTimeout(() => setOpen(false), 500)
  }

  return (
    <Card className="col-span-2 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {open ? (
          <motion.div
            key="flow"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mb-1 flex h-8 items-center justify-between">
              {step > 0 ? (
                <motion.button
                  {...tapScale}
                  onClick={goBack}
                  className="flex items-center gap-0.5 text-sm text-slate-500 dark:text-slate-400"
                >
                  <ChevronLeft size={18} /> Back
                </motion.button>
              ) : (
                <span />
              )}
              <button onClick={() => setOpen(false)} className="text-xs text-slate-400 dark:text-slate-500">
                Cancel
              </button>
            </div>
            <StepDots total={2} current={step} />

            <AnimatePresence mode="wait" custom={direction}>
              {step === 0 && (
                <FlowStep key="category" direction={direction}>
                  <PickerGrid
                    title="Category"
                    items={categories.map((c) => ({ id: c.id, label: c.name, dotColor: c.color }))}
                    onPick={(id) => {
                      setCategoryId(id)
                      goNext()
                    }}
                  />
                </FlowStep>
              )}

              {step === 1 && (
                <FlowStep key="limit" direction={direction}>
                  <div className="space-y-3">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category?.color }} />
                      {category?.name}
                    </p>

                    <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                      {recommendationLoading && (
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <div
                            className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600 dark:border-slate-700 dark:border-t-indigo-400"
                            role="status"
                            aria-label="Loading suggestion"
                          />
                          Working out a suggestion…
                        </div>
                      )}
                      {!recommendationLoading && recommendation && (
                        <div className="space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs text-slate-600 dark:text-slate-400">{recommendation.reason}</p>
                            {recommendation.tier !== 'template' && (
                              <span className="inline-flex shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                AI-enhanced
                              </span>
                            )}
                          </div>
                          {recommendation.suggestedAmount !== null && (
                            <motion.button
                              {...tapScale}
                              type="button"
                              onClick={() => setLimit(String(recommendation.suggestedAmount))}
                              className="inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                            >
                              Use {formatMoney(recommendation.suggestedAmount)}
                            </motion.button>
                          )}
                        </div>
                      )}
                    </div>

                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      autoFocus
                      value={limit}
                      onChange={(e) => setLimit(e.target.value)}
                      placeholder="Monthly limit"
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-2xl tabular-money transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <motion.button
                      {...tapScale}
                      type="button"
                      disabled={!(Number(limit) > 0)}
                      onClick={save}
                      animate={saved ? { backgroundColor: '#16a34a' } : { backgroundColor: '#4f46e5' }}
                      className="flex w-full items-center justify-center gap-2 rounded-xl py-3 font-semibold text-white disabled:opacity-40"
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        {saved ? (
                          <motion.span
                            key="saved"
                            initial={{ opacity: 0, scale: 0.7 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex items-center gap-1.5"
                          >
                            <Check size={18} /> Added
                          </motion.span>
                        ) : (
                          <motion.span key="save" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            Add budget
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  </div>
                </FlowStep>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.button key="cta" {...tapScale} onClick={openFlow} className="flex w-full items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Plus size={16} /> Add budget
          </motion.button>
        )}
      </AnimatePresence>
    </Card>
  )
}
