import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Download,
  Upload,
  ShieldCheck,
  ShieldAlert,
  HardDrive,
  AlertTriangle,
  Loader2,
  CheckCircle2,
} from 'lucide-react'
import Card from '../components/Card'
import { staggerContainer, fadeUpItem, tapScale } from '../lib/motion'
import { exportBackup, importBackup } from '../lib/backup'

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
