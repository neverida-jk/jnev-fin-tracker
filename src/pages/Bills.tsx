import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Trash2, Check, ChevronLeft, AlertTriangle } from 'lucide-react'
import db, { type BillFrequency, type RecurringBill } from '../db'
import { formatMoney } from '../lib/format'
import { currentMonthKey, todayISO } from '../lib/dates'
import { getBillsThisMonth } from '../lib/bills'
import { ACCOUNT_ICONS } from '../lib/accountIcons'
import Card from '../components/Card'
import PayoutDatesManager from '../components/PayoutDatesManager'
import FlowStep from '../components/FlowStep'
import StepDots from '../components/StepDots'
import PickerGrid from '../components/PickerGrid'
import { staggerContainer, fadeUpItem, tapScale } from '../lib/motion'

export default function Bills() {
  return (
    <div className="mx-4 mt-4 space-y-8 pb-6">
      <RecurringBills />
      <PayoutSchedules />
    </div>
  )
}

function PayoutSchedules() {
  const schedules = useLiveQuery(() => db.payoutSchedules.toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const accountsById = new Map((accounts ?? []).map((a) => [a.id, a]))
  const categoriesById = new Map((categories ?? []).map((c) => [c.id, c]))
  const incomeCategories = (categories ?? []).filter((c) => c.kind === 'income')

  async function toggleActive(id: number, active: boolean) {
    await db.payoutSchedules.update(id, { active: !active })
  }

  async function removeSchedule(id: number) {
    await db.payoutDates.where('scheduleId').equals(id).delete()
    await db.payoutSchedules.delete(id)
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
        Payout schedule
      </h2>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Dates set by your employer — the amount varies, so you log it each time it lands.
      </p>
      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-2">
        <AnimatePresence initial={false}>
          {(schedules ?? []).map((schedule) => (
            <Card
              key={schedule.id}
              layout
              variants={fadeUpItem}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
              className="!p-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-200">{schedule.label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {accountsById.get(schedule.accountId)?.name} ·{' '}
                    {categoriesById.get(schedule.categoryId)?.name}
                  </p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.85 }}
                  onClick={() => removeSchedule(schedule.id)}
                  aria-label="Remove schedule"
                >
                  <Trash2 size={16} className="text-slate-400" />
                </motion.button>
              </div>
              <div className="mt-2">
                <ToggleSwitch
                  checked={schedule.active}
                  onChange={() => toggleActive(schedule.id, schedule.active)}
                  label="Active"
                />
              </div>
              <PayoutDatesManager scheduleId={schedule.id} />
            </Card>
          ))}
        </AnimatePresence>
      </motion.div>

      <AddPayoutScheduleFlow accounts={accounts ?? []} incomeCategories={incomeCategories} />
    </section>
  )
}

function AddPayoutScheduleFlow({
  accounts,
  incomeCategories,
}: {
  accounts: { id: number; name: string; type: keyof typeof ACCOUNT_ICONS }[]
  incomeCategories: { id: number; name: string; color: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [label, setLabel] = useState('')
  const [accountId, setAccountId] = useState<number | ''>('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [saved, setSaved] = useState(false)

  function openFlow() {
    setStep(0)
    setDirection(1)
    setLabel('')
    setAccountId('')
    setCategoryId('')
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
    if (!label.trim() || accountId === '' || categoryId === '') return
    await db.payoutSchedules.add({
      id: undefined as unknown as number,
      label: label.trim(),
      accountId,
      categoryId,
      active: true,
    })
    setSaved(true)
    setTimeout(() => setOpen(false), 500)
  }

  const account = accounts.find((a) => a.id === accountId)
  const category = incomeCategories.find((c) => c.id === categoryId)

  return (
    <Card className="mt-3 overflow-hidden">
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
            <StepDots total={4} current={step} />

            <AnimatePresence mode="wait" custom={direction}>
              {step === 0 && (
                <FlowStep key="label" direction={direction}>
                  <div className="space-y-3">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                      What's this payout called?
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Salary"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      autoFocus
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <motion.button
                      {...tapScale}
                      type="button"
                      disabled={!label.trim()}
                      onClick={goNext}
                      className="w-full rounded-xl bg-linear-to-br from-brand-from to-brand-to py-3 font-medium text-white shadow-md shadow-violet-900/30 disabled:opacity-40 disabled:shadow-none"
                    >
                      Next
                    </motion.button>
                  </div>
                </FlowStep>
              )}

              {step === 1 && (
                <FlowStep key="account" direction={direction}>
                  <PickerGrid
                    title="Deposit account"
                    items={accounts.map((a) => ({ id: a.id, label: a.name, icon: ACCOUNT_ICONS[a.type] }))}
                    onPick={(id) => {
                      setAccountId(id)
                      goNext()
                    }}
                  />
                </FlowStep>
              )}

              {step === 2 && (
                <FlowStep key="category" direction={direction}>
                  <PickerGrid
                    title="Income category"
                    items={incomeCategories.map((c) => ({ id: c.id, label: c.name, dotColor: c.color }))}
                    onPick={(id) => {
                      setCategoryId(id)
                      goNext()
                    }}
                  />
                </FlowStep>
              )}

              {step === 3 && (
                <FlowStep key="confirm" direction={direction}>
                  <div className="space-y-3">
                    <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                      <p className="font-medium text-slate-800 dark:text-slate-200">{label}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {account?.name} · {category?.name}
                      </p>
                    </div>
                    <motion.button
                      {...tapScale}
                      type="button"
                      onClick={save}
                      animate={saved ? { backgroundColor: '#16a34a' } : { backgroundColor: '#4f46e5' }}
                      className="flex w-full items-center justify-center gap-2 rounded-xl py-3 font-medium text-white"
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
                            Add payout schedule
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
            <Plus size={16} /> Add payout schedule
          </motion.button>
        )}
      </AnimatePresence>
    </Card>
  )
}

function RecurringBills() {
  const bills = useLiveQuery(() => db.recurringBills.toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const accountsById = new Map((accounts ?? []).map((a) => [a.id, a]))
  const categoriesById = new Map((categories ?? []).map((c) => [c.id, c]))
  const expenseCategories = (categories ?? []).filter((c) => c.kind === 'expense')

  async function markPaid(bill: RecurringBill) {
    await db.transactions.add({
      id: undefined as unknown as number,
      accountId: bill.accountId,
      categoryId: bill.categoryId,
      amount: bill.amount,
      date: new Date().toISOString().slice(0, 10),
      note: 'Bill payment',
      createdAt: new Date().toISOString(),
    })
    if (bill.frequency === 'once') {
      await db.recurringBills.update(bill.id, { paid: true })
    } else {
      await db.recurringBills.update(bill.id, { lastPaidMonth: currentMonthKey() })
    }
  }

  async function removeBill(id: number) {
    await db.recurringBills.delete(id)
  }

  const withStatus = getBillsThisMonth(bills ?? [])

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
        Recurring bills
      </h2>
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="grid grid-flow-row-dense grid-cols-2 gap-3"
      >
        <AnimatePresence initial={false}>
          {withStatus.map(({ bill, dueDate, paidThisMonth, overdue }) => (
            <Card
              key={bill.id}
              layout
              variants={fadeUpItem}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
              className="col-span-1 !p-3"
            >
              <div className="flex items-start justify-between gap-1">
                <p className="truncate font-medium text-slate-800 dark:text-slate-200">{bill.name}</p>
                <motion.button
                  whileTap={{ scale: 0.85 }}
                  onClick={() => removeBill(bill.id)}
                  aria-label="Remove bill"
                  className="shrink-0"
                >
                  <Trash2 size={14} className="text-slate-400" />
                </motion.button>
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {formatMoney(bill.amount)} · due{' '}
                {dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {bill.frequency === 'once' && ' · one-time'}
              </p>
              {overdue && (
                <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                  <AlertTriangle size={12} /> Overdue
                </p>
              )}
              <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                {accountsById.get(bill.accountId)?.name} · {categoriesById.get(bill.categoryId)?.name}
              </p>
              <div className="mt-2">
                <AnimatePresence mode="wait">
                  {paidThisMonth ? (
                    <motion.span
                      key="paid"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400"
                    >
                      <Check size={14} /> {bill.frequency === 'once' ? 'Paid' : 'Paid this month'}
                    </motion.span>
                  ) : (
                    <motion.button
                      key="markpaid"
                      {...tapScale}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={() => markPaid(bill)}
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    >
                      Mark paid
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </Card>
          ))}
        </AnimatePresence>
      </motion.div>

      <AddRecurringBillFlow accounts={accounts ?? []} expenseCategories={expenseCategories} />
    </section>
  )
}

function AddRecurringBillFlow({
  accounts,
  expenseCategories,
}: {
  accounts: { id: number; name: string; type: keyof typeof ACCOUNT_ICONS }[]
  expenseCategories: { id: number; name: string; color: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [frequency, setFrequency] = useState<BillFrequency>('monthly')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDay, setDueDay] = useState('1')
  const [dueDate, setDueDate] = useState(todayISO())
  const [accountId, setAccountId] = useState<number | ''>('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [saved, setSaved] = useState(false)

  function openFlow() {
    setStep(0)
    setDirection(1)
    setFrequency('monthly')
    setName('')
    setAmount('')
    setDueDay('1')
    setDueDate(todayISO())
    setAccountId('')
    setCategoryId('')
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
    if (!name.trim() || !amount || accountId === '' || categoryId === '') return
    await db.recurringBills.add({
      id: undefined as unknown as number,
      name: name.trim(),
      amount: Number(amount),
      frequency,
      dueDay: Math.min(31, Math.max(1, Number(dueDay) || 1)),
      dueDate: frequency === 'once' ? dueDate : undefined,
      accountId,
      categoryId,
      active: true,
    })
    setSaved(true)
    setTimeout(() => setOpen(false), 500)
  }

  const account = accounts.find((a) => a.id === accountId)
  const category = expenseCategories.find((c) => c.id === categoryId)
  const nameAmountValid = name.trim() && Number(amount) > 0

  return (
    <Card className="mt-3 overflow-hidden">
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
            <StepDots total={6} current={step} />

            <AnimatePresence mode="wait" custom={direction}>
              {step === 0 && (
                <FlowStep key="frequency" direction={direction}>
                  <div className="space-y-3">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                      Recurring or one-time?
                    </label>
                    <div className="grid grid-cols-2 gap-2.5">
                      {(['monthly', 'once'] as BillFrequency[]).map((f) => (
                        <motion.button
                          key={f}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => {
                            setFrequency(f)
                            goNext()
                          }}
                          className="flex flex-col items-center gap-1 rounded-xl border border-slate-200/80 bg-white py-4 text-sm font-medium text-slate-700 shadow-sm shadow-slate-900/5 transition-colors hover:border-indigo-200 hover:bg-indigo-50/60 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/40"
                        >
                          {f === 'monthly' ? 'Recurring' : 'One-time'}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </FlowStep>
              )}

              {step === 1 && (
                <FlowStep key="name" direction={direction}>
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Bill name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      placeholder="Amount"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-lg transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <motion.button
                      {...tapScale}
                      type="button"
                      disabled={!nameAmountValid}
                      onClick={goNext}
                      className="w-full rounded-xl bg-linear-to-br from-brand-from to-brand-to py-3 font-medium text-white shadow-md shadow-violet-900/30 disabled:opacity-40 disabled:shadow-none"
                    >
                      Next
                    </motion.button>
                  </div>
                </FlowStep>
              )}

              {step === 2 && frequency === 'monthly' && (
                <FlowStep key="dueday" direction={direction}>
                  <div className="space-y-3">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                      Due day of month
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      autoFocus
                      value={dueDay}
                      onChange={(e) => setDueDay(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-lg transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <motion.button
                      {...tapScale}
                      type="button"
                      onClick={goNext}
                      className="w-full rounded-xl bg-linear-to-br from-brand-from to-brand-to py-3 font-medium text-white shadow-md shadow-violet-900/30"
                    >
                      Next
                    </motion.button>
                  </div>
                </FlowStep>
              )}

              {step === 2 && frequency === 'once' && (
                <FlowStep key="duedate" direction={direction}>
                  <div className="space-y-3">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Due date</label>
                    <input
                      type="date"
                      autoFocus
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-lg transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <motion.button
                      {...tapScale}
                      type="button"
                      onClick={goNext}
                      className="w-full rounded-xl bg-linear-to-br from-brand-from to-brand-to py-3 font-medium text-white shadow-md shadow-violet-900/30"
                    >
                      Next
                    </motion.button>
                  </div>
                </FlowStep>
              )}

              {step === 3 && (
                <FlowStep key="account" direction={direction}>
                  <PickerGrid
                    title="Pay from account"
                    items={accounts.map((a) => ({ id: a.id, label: a.name, icon: ACCOUNT_ICONS[a.type] }))}
                    onPick={(id) => {
                      setAccountId(id)
                      goNext()
                    }}
                  />
                </FlowStep>
              )}

              {step === 4 && (
                <FlowStep key="category" direction={direction}>
                  <PickerGrid
                    title="Category"
                    items={expenseCategories.map((c) => ({ id: c.id, label: c.name, dotColor: c.color }))}
                    onPick={(id) => {
                      setCategoryId(id)
                      goNext()
                    }}
                  />
                </FlowStep>
              )}

              {step === 5 && (
                <FlowStep key="confirm" direction={direction}>
                  <div className="space-y-3">
                    <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                      <p className="font-medium text-slate-800 dark:text-slate-200">{name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {formatMoney(Number(amount) || 0)} ·{' '}
                        {frequency === 'monthly' ? `due day ${dueDay}` : `due ${dueDate}`} · {account?.name} ·{' '}
                        {category?.name}
                      </p>
                    </div>
                    <motion.button
                      {...tapScale}
                      type="button"
                      onClick={save}
                      animate={saved ? { backgroundColor: '#16a34a' } : { backgroundColor: '#4f46e5' }}
                      className="flex w-full items-center justify-center gap-2 rounded-xl py-3 font-medium text-white"
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
                            Add bill
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
            <Plus size={16} /> Add bill
          </motion.button>
        )}
      </AnimatePresence>
    </Card>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"
    >
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'
        }`}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow"
          style={{ left: checked ? 18 : 2 }}
        />
      </span>
      {label}
    </button>
  )
}
