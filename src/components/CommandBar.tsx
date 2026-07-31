import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import { Sparkles, X, Check, Undo2, ArrowRight, Pencil, HelpCircle } from 'lucide-react'
import db, { saveCommandAlias } from '../db'
import {
  parseCommand,
  getFuzzyFields,
  fuzzyFieldPhrase,
  type ParsedCommand,
  type FuzzyField,
} from '../lib/commandParser'
import { executeCommand, type ExecutionResult } from '../lib/commandExecutor'
import { ACCOUNT_ICONS } from '../lib/accountIcons'
import PickerGrid from './PickerGrid'
import { tapScale } from '../lib/motion'

// Which category "kind" a fuzzy categoryId belongs to, per command type — so
// the correction picker offers the right list (income vs expense).
function categoryKindFor(cmd: ParsedCommand): 'income' | 'expense' {
  return cmd.type === 'income' || cmd.type === 'addPayoutSchedule' ? 'income' : 'expense'
}

function fuzzyFieldLabel(field: FuzzyField): string {
  switch (field) {
    case 'accountId':
      return 'Account'
    case 'categoryId':
      return 'Category'
    case 'fromAccountId':
      return 'From'
    case 'toAccountId':
      return 'To'
  }
}

// Slightly friendlier wording than fuzzyFieldLabel for the "Choose ___"
// picker heading (PickerGrid lowercases whatever it's given).
function fuzzyFieldPickerTitle(field: FuzzyField): string {
  switch (field) {
    case 'accountId':
      return 'account'
    case 'categoryId':
      return 'category'
    case 'fromAccountId':
      return 'source account'
    case 'toAccountId':
      return 'destination account'
  }
}

const EXAMPLES = [
  'expense 200 groceries',
  'add maribank with 500',
  'transfer 300 gcash to savings',
  'budget dining 3000',
  'add bill netflix 149 due 15',
  'how much can i spend on dining',
]

export default function CommandBar() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [result, setResult] = useState<ExecutionResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [fixing, setFixing] = useState<'account' | 'category' | null>(null)

  // Pre-execution confidence gate: fuzzy-matched fields on the *current*
  // parsed command that the user has already confirmed or corrected, and any
  // corrections (entity id overrides) they picked instead of the guess. Reset
  // whenever the input text changes — see resetFuzzyGate().
  const [confirmedFuzzyFields, setConfirmedFuzzyFields] = useState<Set<FuzzyField>>(new Set())
  const [fuzzyOverrides, setFuzzyOverrides] = useState<Partial<Record<FuzzyField, number>>>({})
  const [correctingField, setCorrectingField] = useState<FuzzyField | null>(null)

  function resetFuzzyGate() {
    setConfirmedFuzzyFields(new Set())
    setFuzzyOverrides({})
    setCorrectingField(null)
  }

  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const aliases = useLiveQuery(() => db.commandAliases.toArray(), [], [])
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], [])
  const transfers = useLiveQuery(() => db.transfers.toArray(), [], [])
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], [])
  const payoutSchedules = useLiveQuery(() => db.payoutSchedules.toArray(), [], [])
  const payoutDates = useLiveQuery(() => db.payoutDates.toArray(), [], [])
  const fixedTransaction = useLiveQuery(
    () => (result?.transactionId !== undefined ? db.transactions.get(result.transactionId) : undefined),
    [result?.transactionId],
  )

  const defaultAccountId = useMemo(() => {
    if (!transactions || transactions.length === 0) return undefined
    return transactions.reduce((latest, t) => (t.createdAt > latest.createdAt ? t : latest)).accountId
  }, [transactions])

  const displayMessage = useMemo(() => {
    if (!result) return ''
    if (result.ok && fixedTransaction && accounts && categories) {
      const account = accounts.find((a) => a.id === fixedTransaction.accountId)
      const category = categories.find((c) => c.id === fixedTransaction.categoryId)
      if (account && category) {
        const kind = category.kind === 'income' ? 'Income' : 'Expense'
        return `${kind} ₱${fixedTransaction.amount.toLocaleString()} · ${category.name} · ${account.name}`
      }
    }
    return result.message
  }, [result, fixedTransaction, accounts, categories])

  const parsed = useMemo(() => {
    if (!text.trim() || !accounts || !categories) return null
    return parseCommand(text, {
      accounts,
      categories,
      aliases: aliases ?? [],
      defaultAccountId,
      budgets: budgets ?? [],
      transactions: transactions ?? [],
      transfers: transfers ?? [],
      payoutSchedules: payoutSchedules ?? [],
      payoutDates: payoutDates ?? [],
    })
  }, [text, accounts, categories, aliases, defaultAccountId, budgets, transactions, transfers, payoutSchedules, payoutDates])

  // Fields on the current parsed command whose match is a low-confidence
  // (Levenshtein) guess — these need an explicit "yes"/correction before
  // executeCommand ever gets called. See src/lib/commandParser.ts.
  const fuzzyFields = useMemo(() => (parsed ? getFuzzyFields(parsed) : []), [parsed])
  const pendingFuzzyFields = useMemo(
    () => fuzzyFields.filter((f) => !confirmedFuzzyFields.has(f) && fuzzyOverrides[f] === undefined),
    [fuzzyFields, confirmedFuzzyFields, fuzzyOverrides],
  )

  // The command actually sent to executeCommand — the parser's guess for any
  // fuzzy field the user corrected via the inline picker, left as-is
  // otherwise (including fields the user just confirmed as correct).
  const effectiveCommand = useMemo(() => {
    if (!parsed || Object.keys(fuzzyOverrides).length === 0) return parsed
    return { ...parsed, ...fuzzyOverrides }
  }, [parsed, fuzzyOverrides])

  function openBar() {
    setOpen(true)
    setText('')
    setResult(null)
    setFixing(null)
    resetFuzzyGate()
  }

  function closeBar() {
    setOpen(false)
    setText('')
    setResult(null)
    setFixing(null)
    resetFuzzyGate()
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!effectiveCommand || busy || pendingFuzzyFields.length > 0) return
    setBusy(true)
    const res = await executeCommand(effectiveCommand)
    setBusy(false)
    setResult(res)
    setFixing(null)
    resetFuzzyGate()
    if (res.ok) setText('')
  }

  // User said the fuzzy guess was right — lock it in as a learned alias
  // (so the same phrase resolves exactly next time) and let it through the
  // gate without changing the guessed entity.
  async function confirmFuzzyField(field: FuzzyField) {
    if (!parsed) return
    const id = parsed[field]
    if (id === undefined) return
    const phraseInfo = fuzzyFieldPhrase(parsed, field)
    if (phraseInfo) {
      await saveCommandAlias(phraseInfo.phrase, phraseInfo.entityType, id)
    }
    setConfirmedFuzzyFields((prev) => new Set(prev).add(field))
  }

  // User picked a different account/category than the guess — override it
  // for this submission and learn the correction as an alias too, same as
  // confirming, just pointed at the entity the user actually chose.
  async function correctFuzzyField(field: FuzzyField, entityId: number) {
    if (parsed) {
      const phraseInfo = fuzzyFieldPhrase(parsed, field)
      if (phraseInfo) {
        await saveCommandAlias(phraseInfo.phrase, phraseInfo.entityType, entityId)
      }
    }
    setFuzzyOverrides((prev) => ({ ...prev, [field]: entityId }))
    setCorrectingField(null)
  }

  function fuzzyFieldEntityName(field: FuzzyField, id: number): string {
    if (field === 'categoryId') return (categories ?? []).find((c) => c.id === id)?.name ?? 'Unknown'
    return (accounts ?? []).find((a) => a.id === id)?.name ?? 'Unknown'
  }

  async function handleUndo() {
    if (!result?.undo) return
    await result.undo()
    setResult({ ok: true, message: 'Undone.' })
  }

  async function applyFix(entityId: number) {
    if (!result?.transactionId || !fixing) return
    await db.transactions.update(result.transactionId, {
      [fixing === 'account' ? 'accountId' : 'categoryId']: entityId,
    })
    const phrase = fixing === 'account' ? result.accountPhrase : result.categoryPhrase
    if (phrase) {
      await saveCommandAlias(phrase, fixing, entityId)
    }
    setFixing(null)
  }

  const expenseCategories = (categories ?? []).filter((c) => c.kind === 'expense' && !c.system)
  const incomeCategories = (categories ?? []).filter((c) => c.kind === 'income' && !c.system)
  const categoryOptions = fixedTransaction
    ? (categories ?? []).find((c) => c.id === fixedTransaction.categoryId)?.kind === 'income'
      ? incomeCategories
      : expenseCategories
    : expenseCategories

  return (
    <>
      <motion.button
        {...tapScale}
        onClick={openBar}
        className="absolute bottom-20 right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-900/30"
        aria-label="Quick command"
      >
        <Sparkles size={20} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeBar}
              className="absolute inset-0 z-30 bg-black/40"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 40 }}
              className="absolute inset-x-0 bottom-0 z-40 rounded-t-2xl bg-white p-4 pb-6 shadow-2xl dark:bg-slate-900"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  <Sparkles size={16} className="text-indigo-500" />
                  Quick command
                </div>
                <button onClick={closeBar} aria-label="Close">
                  <X size={18} className="text-slate-400" />
                </button>
              </div>

              {correctingField ? (
                <div>
                  <button
                    onClick={() => setCorrectingField(null)}
                    className="mb-2 text-xs font-medium text-indigo-600 dark:text-indigo-400"
                  >
                    ← Back
                  </button>
                  <PickerGrid
                    title={fuzzyFieldPickerTitle(correctingField)}
                    items={
                      correctingField === 'categoryId'
                        ? (parsed && categoryKindFor(parsed) === 'income' ? incomeCategories : expenseCategories).map(
                            (c) => ({ id: c.id, label: c.name, dotColor: c.color }),
                          )
                        : (accounts ?? []).map((a) => ({ id: a.id, label: a.name, icon: ACCOUNT_ICONS[a.type] }))
                    }
                    onPick={(id) => correctFuzzyField(correctingField, id)}
                  />
                </div>
              ) : fixing ? (
                <div>
                  <button
                    onClick={() => setFixing(null)}
                    className="mb-2 text-xs font-medium text-indigo-600 dark:text-indigo-400"
                  >
                    ← Back
                  </button>
                  <PickerGrid
                    title={fixing === 'account' ? 'account' : 'category'}
                    items={
                      fixing === 'account'
                        ? (accounts ?? []).map((a) => ({ id: a.id, label: a.name, icon: ACCOUNT_ICONS[a.type] }))
                        : categoryOptions.map((c) => ({ id: c.id, label: c.name, dotColor: c.color }))
                    }
                    onPick={applyFix}
                  />
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-3">
                  <input
                    type="text"
                    autoFocus
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value)
                      setResult(null)
                      resetFuzzyGate()
                    }}
                    placeholder='Try "expense 200 groceries"'
                    className="w-full rounded-lg border border-slate-300 px-3 py-3 text-base dark:border-slate-700 dark:bg-slate-800"
                  />

                  <AnimatePresence mode="wait" initial={false}>
                    {parsed && !result && (
                      <motion.div
                        key="preview"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                          parsed.type === 'unrecognized'
                            ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                            : 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'
                        }`}
                      >
                        {parsed.type !== 'unrecognized' && <ArrowRight size={14} className="shrink-0" />}
                        <span>{parsed.summary}</span>
                      </motion.div>
                    )}

                    {result && (
                      <motion.div
                        key="result"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`space-y-1.5 rounded-lg px-3 py-2 text-sm ${
                          result.ok
                            ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                            : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2">
                            {result.ok && <Check size={14} className="shrink-0" />}
                            {displayMessage}
                          </span>
                          {result.ok && result.undo && (
                            <button
                              type="button"
                              onClick={handleUndo}
                              className="flex shrink-0 items-center gap-1 text-xs font-medium underline"
                            >
                              <Undo2 size={12} /> Undo
                            </button>
                          )}
                        </div>
                        {result.ok && result.transactionId !== undefined && (
                          <div className="flex gap-3 pt-0.5 text-xs">
                            <button
                              type="button"
                              onClick={() => setFixing('account')}
                              className="flex items-center gap-1 font-medium text-green-700 underline dark:text-green-300"
                            >
                              <Pencil size={11} /> Wrong account?
                            </button>
                            <button
                              type="button"
                              onClick={() => setFixing('category')}
                              className="flex items-center gap-1 font-medium text-green-700 underline dark:text-green-300"
                            >
                              <Pencil size={11} /> Wrong category?
                            </button>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {parsed && !result && pendingFuzzyFields.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950"
                    >
                      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-200">
                        <HelpCircle size={13} className="shrink-0" />
                        Not sure — please confirm:
                      </p>
                      {pendingFuzzyFields.map((field) => {
                        const id = parsed[field]
                        if (id === undefined) return null
                        return (
                          <div
                            key={field}
                            className="flex items-center justify-between gap-2 rounded-md bg-white px-2.5 py-1.5 dark:bg-slate-800"
                          >
                            <span className="text-slate-700 dark:text-slate-300">
                              {fuzzyFieldLabel(field)}: <strong>{fuzzyFieldEntityName(field, id)}</strong>
                            </span>
                            <span className="flex shrink-0 gap-3">
                              <button
                                type="button"
                                onClick={() => confirmFuzzyField(field)}
                                className="flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400"
                              >
                                <Check size={12} /> Yes
                              </button>
                              <button
                                type="button"
                                onClick={() => setCorrectingField(field)}
                                className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400"
                              >
                                <Pencil size={11} /> Fix
                              </button>
                            </span>
                          </div>
                        )
                      })}
                    </motion.div>
                  )}

                  <motion.button
                    {...tapScale}
                    type="submit"
                    disabled={!parsed || parsed.type === 'unrecognized' || busy || pendingFuzzyFields.length > 0}
                    className="w-full rounded-lg bg-indigo-600 py-3 font-medium text-white disabled:opacity-40"
                  >
                    {busy
                      ? 'Working…'
                      : pendingFuzzyFields.length > 0
                        ? 'Confirm above first'
                        : parsed?.type === 'query'
                          ? 'Ask'
                          : 'Execute'}
                  </motion.button>

                  {!text && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {EXAMPLES.map((ex) => (
                        <button
                          key={ex}
                          type="button"
                          onClick={() => setText(ex)}
                          className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  )}
                </form>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
