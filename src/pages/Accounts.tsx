import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Plus,
  ChevronDown,
  ChevronLeft,
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  Check,
  Pencil,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react'
import db, {
  getOrCreateBalanceAdjustmentCategory,
  updateTransaction,
  deleteTransaction,
  updateInvestedValue,
  renameAccount,
  deleteAccount,
  type Account,
  type AccountType,
  type Category,
  type Transaction,
  type Transfer,
} from '../db'
import { accountBalance, signedAmount } from '../lib/finance'
import { formatMoney, formatTime } from '../lib/format'
import { parseISODate, todayISO } from '../lib/dates'
import { ACCOUNT_TYPES, ACCOUNT_ICONS } from '../lib/accountIcons'
import Card from '../components/Card'
import FlowStep from '../components/FlowStep'
import StepDots from '../components/StepDots'
import PickerGrid from '../components/PickerGrid'
import { staggerContainer, fadeUpItem, collapseItem, tapScale } from '../lib/motion'

export default function Accounts() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], [])
  const transfers = useLiveQuery(() => db.transfers.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const categoriesById = new Map((categories ?? []).map((c) => [c.id, c]))
  const accountsById = new Map((accounts ?? []).map((a) => [a.id, a]))

  const [expandedId, setExpandedId] = useState<number | null>(null)

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="mx-4 mt-4 grid grid-flow-row-dense grid-cols-2 gap-3 pb-6"
    >
      <TransferMoney accounts={accounts ?? []} />

      {(accounts ?? []).map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          balance={accountBalance(account, transactions ?? [], transfers ?? [], categoriesById)}
          isExpanded={expandedId === account.id}
          onToggle={() => setExpandedId(expandedId === account.id ? null : account.id)}
          transactions={transactions ?? []}
          transfers={transfers ?? []}
          categories={categories ?? []}
          categoriesById={categoriesById}
          accountsById={accountsById}
        />
      ))}

      <AddAccountFlow />
    </motion.div>
  )
}

interface HistoryEntry {
  id: string
  date: string
  createdAt: string
  label: string
  signed: number
  kind: 'transaction' | 'transfer'
  transaction?: Transaction
}

function AccountCard({
  account,
  balance,
  isExpanded,
  onToggle,
  transactions,
  transfers,
  categories,
  categoriesById,
  accountsById,
}: {
  account: Account
  balance: number
  isExpanded: boolean
  onToggle: () => void
  transactions: Transaction[]
  transfers: Transfer[]
  categories: Category[]
  categoriesById: Map<number, Category>
  accountsById: Map<number, Account>
}) {
  const Icon = ACCOUNT_ICONS[account.type]

  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(account.name)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [editingTxId, setEditingTxId] = useState<number | null>(null)

  const accountHistory: HistoryEntry[] = [
    ...transactions
      .filter((t) => t.accountId === account.id)
      .map((t): HistoryEntry => {
        const category = categoriesById.get(t.categoryId)
        return {
          id: `t${t.id}`,
          date: t.date,
          createdAt: t.createdAt,
          label: `${category?.name ?? 'Unknown'}${t.note ? ` · ${t.note}` : ''}`,
          signed: category ? signedAmount(t.amount, category.kind) : t.amount,
          kind: 'transaction',
          transaction: t,
        }
      }),
    ...transfers
      .filter((tr) => tr.fromAccountId === account.id || tr.toAccountId === account.id)
      .map((tr): HistoryEntry => {
        const isOut = tr.fromAccountId === account.id
        const otherId = isOut ? tr.toAccountId : tr.fromAccountId
        const otherName = accountsById.get(otherId)?.name ?? 'Unknown'
        return {
          id: `x${tr.id}`,
          date: tr.date,
          createdAt: tr.createdAt,
          label: `${isOut ? 'Transfer to' : 'Transfer from'} ${otherName}${tr.note ? ` · ${tr.note}` : ''}`,
          signed: isOut ? -tr.amount : tr.amount,
          kind: 'transfer',
        }
      }),
  // createdAt breaks ties within the same day, so the most recently logged
  // entry is always on top rather than whatever order it happened to be in.
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))

  function startRename() {
    setRenameValue(account.name)
    setAccountError(null)
    setRenaming(true)
  }

  async function saveRename() {
    try {
      await renameAccount(account.id, renameValue)
      setRenaming(false)
      setAccountError(null)
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Could not rename account.')
    }
  }

  async function handleDeleteAccount() {
    setAccountError(null)
    try {
      await deleteAccount(account.id)
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Could not delete account.')
    }
  }

  return (
    <Card
      variants={fadeUpItem}
      layout
      className={`overflow-hidden !p-0 ${isExpanded ? 'col-span-2' : 'col-span-1'}`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        className="flex w-full cursor-pointer flex-col gap-2 px-4 py-3 text-left"
      >
        <div className="flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
            <Icon size={18} />
          </div>
          <div className="flex items-center gap-2">
            {isExpanded && !renaming && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    startRename()
                  }}
                  aria-label="Rename account"
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteAccount()
                  }}
                  aria-label="Delete account"
                  className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
            <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown size={16} className="text-slate-400" />
            </motion.div>
          </div>
        </div>

        {renaming ? (
          <div
            className="flex items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <label htmlFor={`rename-${account.id}`} className="sr-only">
              Account name
            </label>
            <input
              id={`rename-${account.id}`}
              type="text"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-2 py-1 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
            />
            <motion.button
              {...tapScale}
              type="button"
              onClick={saveRename}
              aria-label="Save name"
              className="rounded-lg bg-indigo-600 p-1.5 text-white"
            >
              <Check size={14} />
            </motion.button>
            <motion.button
              {...tapScale}
              type="button"
              onClick={() => setRenaming(false)}
              aria-label="Cancel rename"
              className="rounded-lg bg-slate-100 p-1.5 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            >
              <X size={14} />
            </motion.button>
          </div>
        ) : (
          <div>
            <p className="font-medium text-slate-800 dark:text-slate-200">{account.name}</p>
            <p className="text-xs capitalize text-slate-500 dark:text-slate-400">{account.type}</p>
          </div>
        )}

        <span className="tabular-money font-semibold text-slate-800 dark:text-slate-200">
          {formatMoney(balance)}
        </span>
        {account.type === 'investment' && (
          <span className="-mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">contributed</span>
        )}

        {accountError && (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {accountError}
          </p>
        )}
      </div>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            variants={collapseItem}
            initial="hidden"
            animate="show"
            exit="exit"
            className="border-t border-slate-100 px-4 dark:border-slate-700/60"
          >
            <AddBalanceForm accountId={account.id} />
            {account.type === 'investment' && <InvestedValueForm account={account} />}
            {accountHistory.length === 0 ? (
              <p className="py-3 text-sm text-slate-500 dark:text-slate-400">No transactions yet.</p>
            ) : (
              <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                {accountHistory.slice(0, 20).map((h) => (
                  <li key={h.id} className="text-sm">
                    {h.kind === 'transaction' && h.transaction && editingTxId === h.transaction.id ? (
                      <TransactionEditForm
                        transaction={h.transaction}
                        categories={categories}
                        onClose={() => setEditingTxId(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={h.kind !== 'transaction'}
                        onClick={() => h.transaction && setEditingTxId(h.transaction.id)}
                        className={`flex w-full items-center justify-between gap-2 py-2.5 text-left ${
                          h.kind === 'transaction' ? '' : 'cursor-default'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                          <span className="text-slate-400 dark:text-slate-500">
                            {parseISODate(h.date).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                            , {formatTime(h.createdAt)}
                          </span>{' '}
                          · {h.label}
                        </span>
                        <span
                          className={
                            h.signed < 0
                              ? 'tabular-money shrink-0 text-red-600 dark:text-red-400'
                              : 'tabular-money shrink-0 text-green-600 dark:text-green-400'
                          }
                        >
                          {h.signed < 0 ? '-' : '+'}
                          {formatMoney(Math.abs(h.signed))}
                        </span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

export function TransactionEditForm({
  transaction,
  categories,
  onClose,
}: {
  transaction: Transaction
  categories: Category[]
  onClose: () => void
}) {
  const [amount, setAmount] = useState(String(transaction.amount))
  const [categoryId, setCategoryId] = useState(transaction.categoryId)
  const [date, setDate] = useState(transaction.date)
  const [note, setNote] = useState(transaction.note)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Exclude archived categories from the choices going forward, but keep the
  // transaction's currently-assigned category visible (even if archived) so
  // its chip still renders and shows as selected.
  const pickableCategories = categories.filter(
    (c) => !c.system && (!c.archived || c.id === transaction.categoryId),
  )

  async function save() {
    const numericAmount = Number(amount)
    if (!numericAmount || numericAmount <= 0) {
      setError('Enter a valid amount.')
      return
    }
    await updateTransaction(transaction.id, {
      amount: numericAmount,
      categoryId,
      date,
      note: note.trim(),
    })
    setSaved(true)
    setTimeout(onClose, 400)
  }

  async function remove() {
    await deleteTransaction(transaction.id)
    onClose()
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="space-y-2 overflow-hidden py-2.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Edit transaction</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close edit form"
          className="text-slate-400 dark:text-slate-500"
        >
          <X size={14} />
        </button>
      </div>

      <label htmlFor={`edit-amount-${transaction.id}`} className="sr-only">
        Amount
      </label>
      <input
        id={`edit-amount-${transaction.id}`}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
      />

      <div className="flex flex-wrap gap-1.5">
        {pickableCategories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategoryId(c.id)}
            aria-pressed={categoryId === c.id}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
              categoryId === c.id
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-500/10 dark:text-indigo-300'
                : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
            {c.name}
          </button>
        ))}
      </div>

      <label htmlFor={`edit-date-${transaction.id}`} className="sr-only">
        Date
      </label>
      <input
        id={`edit-date-${transaction.id}`}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
      />

      <label htmlFor={`edit-note-${transaction.id}`} className="sr-only">
        Note
      </label>
      <input
        id={`edit-note-${transaction.id}`}
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
      />

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <motion.button
          {...tapScale}
          type="button"
          onClick={remove}
          className="flex items-center justify-center gap-1 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-400"
        >
          <Trash2 size={13} /> Delete
        </motion.button>
        <motion.button
          {...tapScale}
          type="button"
          onClick={save}
          animate={saved ? { backgroundColor: '#16a34a' } : { backgroundColor: '#4f46e5' }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-semibold text-white"
        >
          <AnimatePresence mode="wait" initial={false}>
            {saved ? (
              <motion.span
                key="saved"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-1.5"
              >
                <Check size={13} /> Saved
              </motion.span>
            ) : (
              <motion.span key="save" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                Save changes
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
    </motion.div>
  )
}

function AddAccountFlow() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [type, setType] = useState<AccountType | ''>('')
  const [name, setName] = useState('')
  const [startingBalance, setStartingBalance] = useState('')
  const [saved, setSaved] = useState(false)

  function openFlow() {
    setStep(0)
    setDirection(1)
    setType('')
    setName('')
    setStartingBalance('')
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
    if (!name.trim() || type === '') return
    await db.accounts.add({
      id: undefined as unknown as number,
      name: name.trim(),
      type,
      startingBalance: Number(startingBalance) || 0,
      createdAt: new Date().toISOString(),
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
                <FlowStep key="type" direction={direction}>
                  <PickerGrid
                    title="Account type"
                    items={ACCOUNT_TYPES.map((t) => ({
                      id: ACCOUNT_TYPES.indexOf(t),
                      label: t,
                      icon: ACCOUNT_ICONS[t],
                    }))}
                    onPick={(id) => {
                      setType(ACCOUNT_TYPES[id])
                      goNext()
                    }}
                  />
                </FlowStep>
              )}

              {step === 1 && (
                <FlowStep key="details" direction={direction}>
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Account name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Starting balance (optional)"
                      value={startingBalance}
                      onChange={(e) => setStartingBalance(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <motion.button
                      {...tapScale}
                      type="button"
                      disabled={!name.trim()}
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
                            Add account
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
            <Plus size={16} /> Add account
          </motion.button>
        )}
      </AnimatePresence>
    </Card>
  )
}

function InvestedValueForm({ account }: { account: Account }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(String(account.investedValue ?? ''))
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await updateInvestedValue(account.id, Number(value))
      setError(null)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update value.')
    }
  }

  return (
    <div className="border-b border-slate-100 py-2.5 dark:border-slate-800">
      {account.investedValue !== undefined && (
        <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">
          Current value{' '}
          <span className="tabular-money font-medium text-slate-700 dark:text-slate-300">
            {formatMoney(account.investedValue)}
          </span>
          {account.investedValueUpdatedAt &&
            ` · updated ${parseISODate(account.investedValueUpdatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
        </p>
      )}
      <AnimatePresence mode="wait" initial={false}>
        {open ? (
          <motion.form
            key="form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={submit}
            className="space-y-2 overflow-hidden"
          >
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Current value"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
            />
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <motion.button
                {...tapScale}
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-xl bg-slate-100 py-1.5 text-xs dark:bg-slate-800"
              >
                Cancel
              </motion.button>
              <motion.button
                {...tapScale}
                type="submit"
                className="flex-1 rounded-xl bg-linear-to-br from-brand-from to-brand-to py-1.5 text-xs font-semibold text-white shadow-sm shadow-violet-900/30"
              >
                Save value
              </motion.button>
            </div>
          </motion.form>
        ) : (
          <motion.button
            key="cta"
            {...tapScale}
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400"
          >
            <TrendingUp size={13} /> {account.investedValue !== undefined ? 'Update value' : 'Set current value'}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

function AddBalanceForm({ accountId }: { accountId: number }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const numericAmount = Number(amount)
    if (!numericAmount || numericAmount <= 0) return

    const category = await getOrCreateBalanceAdjustmentCategory()

    await db.transactions.add({
      id: undefined as unknown as number,
      accountId,
      categoryId: category.id,
      amount: numericAmount,
      date: todayISO(),
      note: note.trim() || 'Balance top-up',
      createdAt: new Date().toISOString(),
    })

    setAmount('')
    setNote('')
    setOpen(false)
  }

  return (
    <div className="py-2">
      <AnimatePresence mode="wait" initial={false}>
        {open ? (
          <motion.form
            key="form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={submit}
            className="space-y-2 overflow-hidden"
          >
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount to add"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
            />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
            />
            <div className="flex gap-2">
              <motion.button
                {...tapScale}
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-xl bg-slate-100 py-1.5 text-xs dark:bg-slate-800"
              >
                Cancel
              </motion.button>
              <motion.button
                {...tapScale}
                type="submit"
                className="flex-1 rounded-xl bg-linear-to-br from-brand-from to-brand-to py-1.5 text-xs font-semibold text-white shadow-sm shadow-violet-900/30"
              >
                Add balance
              </motion.button>
            </div>
          </motion.form>
        ) : (
          <motion.button
            key="cta"
            {...tapScale}
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400"
          >
            <Banknote size={13} /> Add balance
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

function TransferMoney({ accounts }: { accounts: Account[] }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [fromAccountId, setFromAccountId] = useState<number | ''>('')
  const [toAccountId, setToAccountId] = useState<number | ''>('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)

  function openFlow() {
    setStep(0)
    setDirection(1)
    setFromAccountId('')
    setToAccountId('')
    setAmount('')
    setNote('')
    setDate(todayISO())
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
    const numericAmount = Number(amount)
    if (!numericAmount || numericAmount <= 0 || fromAccountId === '' || toAccountId === '') return

    await db.transfers.add({
      id: undefined as unknown as number,
      fromAccountId,
      toAccountId,
      amount: numericAmount,
      date,
      note: note.trim(),
      createdAt: new Date().toISOString(),
    })

    setSaved(true)
    setTimeout(() => setOpen(false), 500)
  }

  const fromAccount = accounts.find((a) => a.id === fromAccountId)
  const toAccount = accounts.find((a) => a.id === toAccountId)
  const numericAmount = Number(amount)

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
              <button
                onClick={() => setOpen(false)}
                className="text-xs text-slate-400 dark:text-slate-500"
              >
                Cancel
              </button>
            </div>
            <StepDots total={3} current={step} />

            <AnimatePresence mode="wait" custom={direction}>
              {step === 0 && (
                <FlowStep key="from" direction={direction}>
                  <PickerGrid
                    title="From account"
                    items={accounts.map((a) => ({ id: a.id, label: a.name, icon: ACCOUNT_ICONS[a.type] }))}
                    onPick={(id) => {
                      setFromAccountId(id)
                      if (toAccountId === id) setToAccountId('')
                      goNext()
                    }}
                  />
                </FlowStep>
              )}

              {step === 1 && (
                <FlowStep key="to" direction={direction}>
                  <PickerGrid
                    title="To account"
                    items={accounts
                      .filter((a) => a.id !== fromAccountId)
                      .map((a) => ({ id: a.id, label: a.name, icon: ACCOUNT_ICONS[a.type] }))}
                    onPick={(id) => {
                      setToAccountId(id)
                      goNext()
                    }}
                  />
                </FlowStep>
              )}

              {step === 2 && (
                <FlowStep key="confirm" direction={direction}>
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                      <span>{fromAccount?.name}</span>
                      <ArrowRight size={14} className="text-slate-400" />
                      <span>{toAccount?.name}</span>
                    </div>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      autoFocus
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-2xl tabular-money transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Note (optional)"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <motion.button
                      {...tapScale}
                      type="button"
                      disabled={!(numericAmount > 0)}
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
                            <Check size={18} /> Transferred
                          </motion.span>
                        ) : (
                          <motion.span key="save" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            Transfer
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
          <motion.button key="cta" {...tapScale} onClick={openFlow} className="flex w-full items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
              <ArrowLeftRight size={18} />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Transfer money</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Move balance between accounts</p>
            </div>
          </motion.button>
        )}
      </AnimatePresence>
    </Card>
  )
}
