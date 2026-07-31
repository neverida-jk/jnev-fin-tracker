import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react'
import db from '../db'
import { parseISODate, todayISO } from '../lib/dates'
import { parsePayoutDates } from '../lib/payoutParse'
import { tapScale, collapseItem } from '../lib/motion'

export default function PayoutDatesManager({ scheduleId }: { scheduleId: number }) {
  const navigate = useNavigate()
  const allDates = useLiveQuery(() => db.payoutDates.where('scheduleId').equals(scheduleId).toArray(), [
    scheduleId,
  ])
  const dates = (allDates ?? []).slice().sort((a, b) => a.date.localeCompare(b.date))
  const todayKey = todayISO()

  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<'single' | 'bulk'>('single')

  const [singleDate, setSingleDate] = useState(todayKey)
  const [singleLabel, setSingleLabel] = useState('')

  const [bulkText, setBulkText] = useState('')
  const [bulkYear, setBulkYear] = useState(String(new Date().getFullYear()))
  const [preview, setPreview] = useState<ReturnType<typeof parsePayoutDates>>([])

  async function addSingle(e: React.FormEvent) {
    e.preventDefault()
    if (!singleDate) return
    await db.payoutDates.add({
      id: undefined as unknown as number,
      scheduleId,
      date: singleDate,
      label: singleLabel.trim() || undefined,
    })
    setSingleLabel('')
  }

  function updatePreview(text: string, year: string) {
    setBulkText(text)
    const yearNum = Number(year) || new Date().getFullYear()
    setPreview(text.trim() ? parsePayoutDates(text, yearNum) : [])
  }

  async function importBulk() {
    if (preview.length === 0) return
    await db.payoutDates.bulkAdd(
      preview.map((p) => ({
        id: undefined as unknown as number,
        scheduleId,
        date: p.date,
        label: p.label,
      })),
    )
    setBulkText('')
    setPreview([])
  }

  async function removeDate(id: number) {
    await db.payoutDates.delete(id)
  }

  return (
    <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-700/60">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        This year's schedule
      </p>
      {dates.length === 0 ? (
        <p className="py-1 text-xs text-slate-500 dark:text-slate-400">No dates yet — paste your schedule below.</p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {dates.map((pd) => {
            const isLogged = Boolean(pd.loggedTransactionId)
            const isPending = !isLogged && pd.date <= todayKey
            return (
              <li key={pd.id} className="flex items-center justify-between gap-2 text-xs">
                <span
                  className={`truncate ${isLogged ? 'text-slate-400 line-through dark:text-slate-600' : 'text-slate-600 dark:text-slate-300'}`}
                  title={pd.label}
                >
                  {parseISODate(pd.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {pd.label ? ` · ${pd.label}` : ''}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {isLogged ? (
                    <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                      <Check size={12} /> Logged
                    </span>
                  ) : isPending ? (
                    <motion.button
                      {...tapScale}
                      onClick={() => navigate(`/add?payoutDateId=${pd.id}`)}
                      className="rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-medium text-white"
                    >
                      Log now
                    </motion.button>
                  ) : (
                    <span className="text-slate-400">Upcoming</span>
                  )}
                  <motion.button whileTap={{ scale: 0.85 }} onClick={() => removeDate(pd.id)} aria-label="Remove date">
                    <Trash2 size={13} className="text-slate-300 dark:text-slate-600" />
                  </motion.button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400"
      >
        Manage dates
        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={12} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div variants={collapseItem} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
            <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
              <div className="flex gap-1 rounded-md bg-slate-200/70 p-0.5 dark:bg-slate-700/70">
                {(['single', 'bulk'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`flex-1 rounded py-1 text-[11px] font-medium capitalize ${
                      mode === m
                        ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {m === 'single' ? 'Add one' : 'Paste table'}
                  </button>
                ))}
              </div>

              {mode === 'single' ? (
                <form onSubmit={addSingle} className="space-y-2">
                  <input
                    type="date"
                    value={singleDate}
                    onChange={(e) => setSingleDate(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                  <input
                    type="text"
                    placeholder="Label (optional)"
                    value={singleLabel}
                    onChange={(e) => setSingleLabel(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                  <motion.button
                    {...tapScale}
                    type="submit"
                    className="flex w-full items-center justify-center gap-1 rounded-md bg-indigo-600 py-1.5 text-xs font-medium text-white"
                  >
                    <Plus size={13} /> Add date
                  </motion.button>
                </form>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Paste your payout table, one date per line — e.g. "No later than 4pm of August 10
                    (Mon)". The year rolls forward automatically unless a line states it explicitly.
                  </p>
                  <input
                    type="number"
                    value={bulkYear}
                    onChange={(e) => {
                      setBulkYear(e.target.value)
                      updatePreview(bulkText, e.target.value)
                    }}
                    placeholder="Starting year"
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                  <textarea
                    value={bulkText}
                    onChange={(e) => updatePreview(e.target.value, bulkYear)}
                    rows={5}
                    placeholder={'No later than 4pm of August 10 (Mon)\nNo later than 4pm of September 8 (Tue)\n...'}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                  {preview.length > 0 && (
                    <div className="rounded-md bg-white p-2 text-[11px] dark:bg-slate-900">
                      <p className="mb-1 flex items-center gap-1 font-medium text-green-600 dark:text-green-400">
                        <Check size={12} /> {preview.length} date{preview.length === 1 ? '' : 's'} parsed
                      </p>
                      <ul className="max-h-24 space-y-0.5 overflow-y-auto text-slate-500 dark:text-slate-400">
                        {preview.map((p, i) => (
                          <li key={i}>{p.date}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <motion.button
                    {...tapScale}
                    type="button"
                    disabled={preview.length === 0}
                    onClick={importBulk}
                    className="flex w-full items-center justify-center gap-1 rounded-md bg-indigo-600 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    <Plus size={13} /> Import {preview.length > 0 ? preview.length : ''} date
                    {preview.length === 1 ? '' : 's'}
                  </motion.button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
