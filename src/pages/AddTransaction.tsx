import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronLeft } from 'lucide-react'
import db, { type CategoryKind } from '../db'
import { todayISO } from '../lib/dates'
import { ACCOUNT_ICONS } from '../lib/accountIcons'
import Card from '../components/Card'
import FlowStep from '../components/FlowStep'
import StepDots from '../components/StepDots'
import PickerGrid from '../components/PickerGrid'
import { tapScale } from '../lib/motion'

export default function AddTransaction() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const payoutDateId = searchParams.get('payoutDateId')
    ? Number(searchParams.get('payoutDateId'))
    : undefined
  const isPayout = Boolean(payoutDateId)

  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const payoutDate = useLiveQuery(
    () => (payoutDateId ? db.payoutDates.get(payoutDateId) : undefined),
    [payoutDateId],
  )
  const schedule = useLiveQuery(
    () => (payoutDate ? db.payoutSchedules.get(payoutDate.scheduleId) : undefined),
    [payoutDate],
  )

  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [kind, setKind] = useState<CategoryKind>(isPayout ? 'income' : 'expense')
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState<number | ''>('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (schedule && payoutDate) {
      setKind('income')
      setAccountId(schedule.accountId)
      setCategoryId(schedule.categoryId)
      setDate(payoutDate.date)
      setNote((n) => n || schedule.label)
    }
  }, [schedule, payoutDate])

  const filteredCategories = useMemo(
    () => (categories ?? []).filter((c) => c.kind === kind && !c.system && !c.archived),
    [categories, kind],
  )

  const totalSteps = isPayout ? 2 : 4

  function goNext() {
    setDirection(1)
    setStep((s) => Math.min(totalSteps - 1, s + 1))
  }
  function goBack() {
    setDirection(-1)
    setStep((s) => Math.max(0, s - 1))
  }

  async function save() {
    const numericAmount = Number(amount)
    if (!numericAmount || numericAmount <= 0 || accountId === '' || categoryId === '') return

    const newTransactionId = await db.transactions.add({
      id: undefined as unknown as number,
      accountId,
      categoryId,
      amount: numericAmount,
      date,
      note,
      payoutDateId,
      createdAt: new Date().toISOString(),
    })

    if (payoutDateId) {
      await db.payoutDates.update(payoutDateId, { loggedTransactionId: newTransactionId })
    }

    setSaved(true)
    setTimeout(() => navigate('/'), 400)
  }

  const numericAmount = Number(amount)
  const amountValid = numericAmount > 0

  return (
    <div className="mx-4 mt-4 pb-6">
      <Card className="min-h-[420px]">
        <div className="mb-1 flex h-8 items-center">
          {step > 0 && (
            <motion.button {...tapScale} onClick={goBack} className="flex items-center gap-0.5 text-sm text-slate-500 dark:text-slate-400">
              <ChevronLeft size={18} /> Back
            </motion.button>
          )}
        </div>
        <StepDots total={totalSteps} current={step} />

        <AnimatePresence mode="wait" custom={direction}>
          {!isPayout && step === 0 && (
            <FlowStep key="amount" direction={direction}>
              <AmountStep
                kind={kind}
                setKind={setKind}
                amount={amount}
                setAmount={setAmount}
                onNext={goNext}
                valid={amountValid}
              />
            </FlowStep>
          )}

          {!isPayout && step === 1 && (
            <FlowStep key="category" direction={direction}>
              <PickerGrid
                title="Category"
                items={filteredCategories.map((c) => ({
                  id: c.id,
                  label: c.name,
                  dotColor: c.color,
                }))}
                onPick={(id) => {
                  setCategoryId(id)
                  goNext()
                }}
              />
            </FlowStep>
          )}

          {!isPayout && step === 2 && (
            <FlowStep key="account" direction={direction}>
              <PickerGrid
                title="Account"
                items={(accounts ?? []).map((a) => ({
                  id: a.id,
                  label: a.name,
                  icon: ACCOUNT_ICONS[a.type],
                }))}
                onPick={(id) => {
                  setAccountId(id)
                  goNext()
                }}
              />
            </FlowStep>
          )}

          {isPayout && step === 0 && (
            <FlowStep key="payout-amount" direction={direction}>
              {schedule && (
                <div className="mb-4 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                  Logging your <strong>{schedule.label}</strong> payout — just enter the amount.
                </div>
              )}
              <AmountStep
                kind="income"
                lockedKind
                amount={amount}
                setAmount={setAmount}
                onNext={goNext}
                valid={amountValid}
              />
            </FlowStep>
          )}

          {((isPayout && step === 1) || (!isPayout && step === 3)) && (
            <FlowStep key="confirm" direction={direction}>
              <ConfirmStep
                date={date}
                setDate={setDate}
                note={note}
                setNote={setNote}
                saved={saved}
                onSave={save}
              />
            </FlowStep>
          )}
        </AnimatePresence>
      </Card>
    </div>
  )
}

function AmountStep({
  kind,
  setKind,
  lockedKind,
  amount,
  setAmount,
  onNext,
  valid,
}: {
  kind: CategoryKind
  setKind?: (k: CategoryKind) => void
  lockedKind?: boolean
  amount: string
  setAmount: (v: string) => void
  onNext: () => void
  valid: boolean
}) {
  return (
    <div className="space-y-4">
      {!lockedKind && setKind && (
        <div className="relative flex gap-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {(['expense', 'income'] as CategoryKind[]).map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => setKind(k)}
              className={`relative z-10 flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors ${
                kind === k ? 'text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {kind === k && (
                <motion.span
                  layoutId="kind-pill"
                  className="absolute inset-0 -z-10 rounded-md bg-indigo-600"
                  transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                />
              )}
              {k}
            </button>
          ))}
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
          Amount
        </label>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-lg border border-slate-300 px-3 py-3 text-2xl dark:border-slate-700 dark:bg-slate-800"
        />
      </div>

      <motion.button
        {...tapScale}
        type="button"
        disabled={!valid}
        onClick={onNext}
        className="w-full rounded-lg bg-indigo-600 py-3 font-medium text-white disabled:opacity-40"
      >
        Next
      </motion.button>
    </div>
  )
}

function ConfirmStep({
  date,
  setDate,
  note,
  setNote,
  saved,
  onSave,
}: {
  date: string
  setDate: (v: string) => void
  note: string
  setNote: (v: string) => void
  saved: boolean
  onSave: () => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
          Date
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
          Note
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
        />
      </div>

      <motion.button
        {...tapScale}
        type="button"
        onClick={onSave}
        animate={saved ? { backgroundColor: '#16a34a' } : { backgroundColor: '#4f46e5' }}
        className="flex w-full items-center justify-center gap-2 rounded-lg py-3 font-medium text-white"
      >
        <AnimatePresence mode="wait" initial={false}>
          {saved ? (
            <motion.span
              key="saved"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-1.5"
            >
              <Check size={18} /> Saved
            </motion.span>
          ) : (
            <motion.span key="save" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              Save transaction
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  )
}
