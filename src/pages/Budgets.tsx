import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Trash2, ChevronLeft, Check } from 'lucide-react'
import db from '../db'
import { spentByCategoryThisMonth } from '../lib/finance'
import { formatMoney } from '../lib/format'
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
  const availableCategories = (categories ?? []).filter(
    (c) => c.kind === 'expense' && !budgetedCategoryIds.has(c.id),
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
                {formatMoney(spent)} spent
              </p>
              <input
                type="number"
                step="0.01"
                defaultValue={budget.monthlyLimit}
                onBlur={(e) => updateLimit(budget.id, e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </Card>
          )
        })}
      </AnimatePresence>

      {availableCategories.length > 0 && <AddBudgetFlow categories={availableCategories} />}
    </motion.div>
  )
}

function AddBudgetFlow({ categories }: { categories: { id: number; name: string; color: string }[] }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [limit, setLimit] = useState('')
  const [saved, setSaved] = useState(false)

  function openFlow() {
    setStep(0)
    setDirection(1)
    setCategoryId('')
    setLimit('')
    setSaved(false)
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

  const category = categories.find((c) => c.id === categoryId)

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
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      autoFocus
                      value={limit}
                      onChange={(e) => setLimit(e.target.value)}
                      placeholder="Monthly limit"
                      className="w-full rounded-lg border border-slate-300 px-3 py-3 text-2xl dark:border-slate-700 dark:bg-slate-800"
                    />
                    <motion.button
                      {...tapScale}
                      type="button"
                      disabled={!(Number(limit) > 0)}
                      onClick={save}
                      animate={saved ? { backgroundColor: '#16a34a' } : { backgroundColor: '#4f46e5' }}
                      className="flex w-full items-center justify-center gap-2 rounded-lg py-3 font-medium text-white disabled:opacity-40"
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
