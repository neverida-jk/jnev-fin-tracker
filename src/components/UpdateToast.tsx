import { AnimatePresence, motion } from 'framer-motion'
import { RefreshCw, X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import Card from './Card'
import { tapScale } from '../lib/motion'

// Registers the PWA service worker in "prompt" mode (see vite.config.ts's
// registerType) and surfaces a small, dismissible banner once a new version
// has finished installing and is just waiting to take over. Previously
// registerType was "autoUpdate", which lets Workbox swap the new service
// worker in and reload the page with no warning — fine for a stable app, but
// risky while this one is being actively redeveloped and redeployed, since a
// silent reload could wipe in-progress input (e.g. mid-way through the Add
// Transaction wizard). "prompt" mode instead waits for the user to say when.
//
// Anchored just below the sticky Header rather than near the bottom of the
// screen, since the bottom edge is already claimed by StatusStrip and the
// CommandBar FAB (see App.tsx) — this keeps the banner from competing with
// either.
export default function UpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('Service worker registration failed', error)
    },
  })

  function dismiss() {
    setNeedRefresh(false)
  }

  return (
    <AnimatePresence>
      {needRefresh && (
        <Card
          key="update-toast"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          role="status"
          className="fixed inset-x-4 top-[4.5rem] z-50 flex items-center justify-between gap-3 sm:inset-x-auto sm:left-1/2 sm:w-80 sm:-translate-x-1/2"
        >
          <button
            type="button"
            onClick={() => updateServiceWorker()}
            className="flex flex-1 items-center gap-2 text-left text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            <RefreshCw size={15} className="shrink-0 text-indigo-500" aria-hidden="true" />
            Update available — tap to refresh
          </button>
          <motion.button
            {...tapScale}
            type="button"
            onClick={dismiss}
            aria-label="Dismiss update notice"
            className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-100/80 hover:text-slate-600 dark:hover:bg-slate-800/80 dark:hover:text-slate-300"
          >
            <X size={14} />
          </motion.button>
        </Card>
      )}
    </AnimatePresence>
  )
}
