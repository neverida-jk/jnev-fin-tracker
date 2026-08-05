import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Download,
  Upload,
  ShieldCheck,
  ShieldAlert,
  HardDrive,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Archive,
  ArchiveRestore,
} from 'lucide-react'
import Card from '../components/Card'
import { staggerContainer, fadeUpItem, tapScale } from '../lib/motion'
import { exportBackup, importBackup } from '../lib/backup'
import db, {
  addCategory,
  updateCategory,
  archiveCategory,
  unarchiveCategory,
  deleteCategory,
  type Category,
  type CategoryKind,
} from '../db'

// Preset swatches reuse the exact colors already assigned to the seeded
// categories (see seedIfEmpty in db.ts) plus one extra tone, so new
// categories visually match the existing palette instead of introducing new
// hues.
const PRESET_COLORS = [
  '#22c55e',
  '#84cc16',
  '#f97316',
  '#ef4444',
  '#eab308',
  '#3b82f6',
  '#ec4899',
  '#a855f7',
  '#64748b',
  '#14b8a6',
]

type Banner = { kind: 'success' | 'error'; message: string } | null

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

export default function Settings() {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="mx-4 mt-4 space-y-5 pb-6"
    >
      <BackupSection />
      <CategoriesSection />
      <StorageSection />
    </motion.div>
  )
}

function BackupSection() {
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [banner, setBanner] = useState<Banner>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleExport() {
    setBanner(null)
    setExporting(true)
    try {
      const backup = await exportBackup()
      const json = JSON.stringify(backup, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const stamp = backup.exportedAt.replace(/[:.]/g, '-')
      const a = document.createElement('a')
      a.href = url
      a.download = `finance-tracker-backup-${stamp}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setBanner({ kind: 'success', message: 'Backup downloaded.' })
    } catch (err) {
      setBanner({ kind: 'error', message: err instanceof Error ? err.message : 'Export failed.' })
    } finally {
      setExporting(false)
    }
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    setBanner(null)
    if (file) setPendingFile(file)
    // Reset so choosing the same file again still fires onChange.
    e.target.value = ''
  }

  function cancelImport() {
    setPendingFile(null)
  }

  async function confirmImport() {
    if (!pendingFile) return
    setImporting(true)
    setBanner(null)
    try {
      const text = await pendingFile.text()
      const parsed = JSON.parse(text) as object
      await importBackup(parsed)
      setBanner({ kind: 'success', message: 'Backup restored. Your data has been replaced.' })
    } catch (err) {
      setBanner({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Import failed. No changes were made.',
      })
    } finally {
      setImporting(false)
      setPendingFile(null)
    }
  }

  return (
    <Card variants={fadeUpItem}>
      <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">Backup &amp; restore</h2>
      <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
        All your data lives only on this device. Export a backup regularly, especially before clearing
        browser data or uninstalling this app.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <motion.button
          {...tapScale}
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Export backup
        </motion.button>

        <motion.button
          {...tapScale}
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
        >
          <Upload size={16} />
          Import backup
        </motion.button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFileChosen}
          className="hidden"
          aria-label="Choose backup file to import"
        />
      </div>

      {pendingFile && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-4 overflow-hidden rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800/60 dark:bg-red-950/40"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-red-800 dark:text-red-300">
                Replace all current data with "{pendingFile.name}"?
              </p>
              <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                Every account, transaction, budget, bill, and schedule currently stored on this device
                will be permanently erased and replaced with the contents of this file. This cannot be
                undone.
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={confirmImport}
              disabled={importing}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {importing && <Loader2 size={14} className="animate-spin" />}
              Yes, replace all data
            </button>
            <button
              type="button"
              onClick={cancelImport}
              disabled={importing}
              className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      )}

      {banner && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`mt-3 flex items-center gap-1.5 text-xs ${
            banner.kind === 'success'
              ? 'text-green-700 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'
          }`}
          role="status"
        >
          {banner.kind === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {banner.message}
        </motion.p>
      )}
    </Card>
  )
}

function CategoriesSection() {
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])

  // System categories (e.g. Balance Adjustment) are internal plumbing, never
  // shown to the user as an editable budget bucket.
  const userCategories = (categories ?? []).filter((c) => !c.system)
  const income = userCategories.filter((c) => c.kind === 'income')
  const expense = userCategories.filter((c) => c.kind === 'expense')

  return (
    <Card variants={fadeUpItem}>
      <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">Categories</h2>
      <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
        Rename, recolor, archive, or delete the categories used across transactions and budgets.
        Archiving keeps existing history intact while hiding a category from new entries.
      </p>

      <div className="space-y-4">
        <CategoryGroup title="Income" categories={income} />
        <CategoryGroup title="Expense" categories={expense} />
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-700/60">
        <AddCategoryForm />
      </div>
    </Card>
  )
}

function CategoryGroup({ title, categories }: { title: string; categories: Category[] }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {title}
      </h3>
      {categories.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          No {title.toLowerCase()} categories yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {categories.map((category) => (
            <CategoryRow key={category.id} category={category} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CategoryRow({ category }: { category: Category }) {
  const [editing, setEditing] = useState(false)
  const [nameValue, setNameValue] = useState(category.name)
  const [colorValue, setColorValue] = useState(category.color)
  const [error, setError] = useState<string | null>(null)

  function startEdit() {
    setNameValue(category.name)
    setColorValue(category.color)
    setError(null)
    setEditing(true)
  }

  async function saveEdit() {
    try {
      await updateCategory(category.id, { name: nameValue, color: colorValue })
      setEditing(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update category.')
    }
  }

  async function toggleArchive() {
    setError(null)
    try {
      if (category.archived) {
        await unarchiveCategory(category.id)
      } else {
        await archiveCategory(category.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update category.')
    }
  }

  async function handleDelete() {
    setError(null)
    try {
      await deleteCategory(category.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete category.')
    }
  }

  return (
    <li className="py-2.5 text-sm">
      {editing ? (
        <div
          className="space-y-2"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false)
          }}
        >
          <div className="flex items-center gap-1.5">
            <label htmlFor={`category-name-${category.id}`} className="sr-only">
              Category name
            </label>
            <input
              id={`category-name-${category.id}`}
              type="text"
              autoFocus
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <motion.button
              {...tapScale}
              type="button"
              onClick={saveEdit}
              aria-label="Save category"
              className="rounded-md bg-indigo-600 p-1.5 text-white"
            >
              <Check size={14} />
            </motion.button>
            <motion.button
              {...tapScale}
              type="button"
              onClick={() => setEditing(false)}
              aria-label="Cancel edit"
              className="rounded-md bg-slate-100 p-1.5 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            >
              <X size={14} />
            </motion.button>
          </div>
          <ColorSwatchPicker value={colorValue} onChange={setColorValue} />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className={`flex min-w-0 items-center gap-2 ${category.archived ? 'opacity-50' : ''}`}>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: category.color }}
            />
            <span className="truncate text-slate-700 dark:text-slate-300">{category.name}</span>
            {category.archived && (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                Archived
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={startEdit}
              aria-label={`Rename or recolor ${category.name}`}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              onClick={toggleArchive}
              aria-label={category.archived ? `Unarchive ${category.name}` : `Archive ${category.name}`}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              {category.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              aria-label={`Delete ${category.name}`}
              className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
            >
              <Trash2 size={14} />
            </button>
          </span>
        </div>
      )}

      {error && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

function ColorSwatchPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (color: string) => void
}) {
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">Category color</legend>
      {PRESET_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          aria-label={`Color ${color}`}
          aria-pressed={value === color}
          className={`h-7 w-7 shrink-0 rounded-full border-2 transition-transform ${
            value === color
              ? 'scale-110 border-slate-800 dark:border-white'
              : 'border-transparent'
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
    </fieldset>
  )
}

function AddCategoryForm() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [color, setColor] = useState<string>(PRESET_COLORS[0])
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function openForm() {
    setName('')
    setKind('expense')
    setColor(PRESET_COLORS[0])
    setError(null)
    setSaved(false)
    setOpen(true)
  }

  async function handleAdd() {
    setError(null)
    try {
      await addCategory({ name, kind, color })
      setSaved(true)
      setTimeout(() => setOpen(false), 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add category.')
    }
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {open ? (
        <motion.div
          key="form"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="space-y-3 overflow-hidden"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Add category</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close add category form"
              className="text-slate-400 dark:text-slate-500"
            >
              <X size={14} />
            </button>
          </div>

          <div className="relative flex gap-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(['expense', 'income'] as CategoryKind[]).map((k) => (
              <button
                type="button"
                key={k}
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`relative z-10 flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors ${
                  kind === k ? 'text-white' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {kind === k && (
                  <motion.span
                    layoutId="new-category-kind-pill"
                    className="absolute inset-0 -z-10 rounded-md bg-indigo-600"
                    transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                  />
                )}
                {k}
              </button>
            ))}
          </div>

          <label htmlFor="new-category-name" className="sr-only">
            Category name
          </label>
          <input
            id="new-category-name"
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Category name"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />

          <ColorSwatchPicker value={color} onChange={setColor} />

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          <motion.button
            {...tapScale}
            type="button"
            disabled={!name.trim()}
            onClick={handleAdd}
            animate={saved ? { backgroundColor: '#16a34a' } : { backgroundColor: '#4f46e5' }}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            <AnimatePresence mode="wait" initial={false}>
              {saved ? (
                <motion.span
                  key="saved"
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-1.5"
                >
                  <Check size={16} /> Added
                </motion.span>
              ) : (
                <motion.span key="save" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  Add category
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </motion.div>
      ) : (
        <motion.button
          key="cta"
          {...tapScale}
          onClick={openForm}
          className="flex w-full items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400"
        >
          <Plus size={16} /> Add category
        </motion.button>
      )}
    </AnimatePresence>
  )
}

type StorageInfo = {
  persisted: boolean
  usage?: number
  quota?: number
  supported: boolean
}

async function readStorageInfo(): Promise<StorageInfo> {
  const supported = typeof navigator !== 'undefined' && !!navigator.storage
  if (!supported) return { persisted: false, supported: false }

  const persisted =
    typeof navigator.storage.persisted === 'function' ? await navigator.storage.persisted() : false

  let usage: number | undefined
  let quota: number | undefined
  if (typeof navigator.storage.estimate === 'function') {
    const estimate = await navigator.storage.estimate()
    usage = estimate.usage
    quota = estimate.quota
  }

  return { persisted, usage, quota, supported: true }
}

function StorageSection() {
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    readStorageInfo().then((result) => {
      if (!cancelled) setInfo(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleRequestPersist() {
    setRequesting(true)
    setError(null)
    try {
      if (typeof navigator.storage?.persist !== 'function') {
        setError('This browser does not support requesting persistent storage.')
        return
      }
      await navigator.storage.persist()
      setInfo(await readStorageInfo())
    } finally {
      setRequesting(false)
    }
  }

  return (
    <Card variants={fadeUpItem}>
      <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">Storage status</h2>
      <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
        This app stores everything in your browser's local database. Persistent storage tells the
        browser not to auto-clear it under storage pressure.
      </p>

      {info === null ? (
        <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 size={14} className="animate-spin" /> Checking storage...
        </p>
      ) : !info.supported ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          This browser doesn't expose storage status information.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            {info.persisted ? (
              <>
                <ShieldCheck size={18} className="shrink-0 text-green-600 dark:text-green-400" />
                <span className="text-slate-700 dark:text-slate-300">
                  Storage is persisted — the browser won't clear it automatically.
                </span>
              </>
            ) : (
              <>
                <ShieldAlert size={18} className="shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="text-slate-700 dark:text-slate-300">
                  Storage is not persisted — it could be cleared under disk pressure.
                </span>
              </>
            )}
          </div>

          {info.usage !== undefined && info.quota !== undefined && info.quota > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <HardDrive size={13} /> {formatBytes(info.usage)} of {formatBytes(info.quota)} used
                </span>
                <span>{((info.usage / info.quota) * 100).toFixed(1)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700/60">
                <motion.div
                  className="h-2 rounded-full bg-indigo-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (info.usage / info.quota) * 100)}%` }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            </div>
          )}

          {!info.persisted && (
            <motion.button
              {...tapScale}
              type="button"
              onClick={handleRequestPersist}
              disabled={requesting}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
            >
              {requesting && <Loader2 size={14} className="animate-spin" />}
              Request persistent storage
            </motion.button>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </Card>
  )
}
