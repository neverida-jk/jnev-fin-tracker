import { lazy, Suspense, useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence } from 'framer-motion'
import Header from './components/Header'
import PageTransition from './components/PageTransition'
import CommandBar from './components/CommandBar'
import StatusStrip from './components/StatusStrip'
import UpdateToast from './components/UpdateToast'
import LockScreen from './components/LockScreen'
import db, { seedIfEmpty } from './db'
import { isLockEnabled } from './lib/appLock'
import { shouldTakeSnapshotToday, takeLocalSnapshot } from './lib/localSnapshot'
import { checkAndNotify } from './lib/notifications'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const AddTransaction = lazy(() => import('./pages/AddTransaction'))
const Accounts = lazy(() => import('./pages/Accounts'))
const Budgets = lazy(() => import('./pages/Budgets'))
const Bills = lazy(() => import('./pages/Bills'))
const Transactions = lazy(() => import('./pages/Transactions'))
const Settings = lazy(() => import('./pages/Settings'))

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/add': 'Add Transaction',
  '/accounts': 'Accounts',
  '/budgets': 'Budgets',
  '/bills': 'Bills & Payouts',
  '/transactions': 'Transactions',
  '/settings': 'Settings',
}

function titleFor(pathname: string): string {
  return titles[pathname] ?? 'Finance Tracker'
}

// Unobtrusive fallback shown briefly while a route's lazy chunk loads —
// intentionally minimal, matching the app's quiet visual style rather than
// introducing a new loading-screen design.
function RouteFallback() {
  return (
    <div className="flex justify-center py-16">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600 dark:border-slate-700 dark:border-t-indigo-400"
        role="status"
        aria-label="Loading"
      />
    </div>
  )
}

function App() {
  const location = useLocation()

  // Cold start begins locked whenever a PIN is set; re-locks immediately on
  // every backgrounding (not after a grace period) — simpler than a timer,
  // and matches how banking apps behave by default.
  const [locked, setLocked] = useState(isLockEnabled)

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden' && isLockEnabled()) {
        setLocked(true)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    seedIfEmpty()
  }, [])

  const bills = useLiveQuery(() => db.recurringBills.toArray(), [], [])
  const payoutSchedules = useLiveQuery(() => db.payoutSchedules.toArray(), [], [])
  const payoutDates = useLiveQuery(() => db.payoutDates.toArray(), [], [])

  useEffect(() => {
    // Best-effort, same as the snapshot check below — checkAndNotify no-ops
    // entirely unless notification permission was already granted in
    // Settings, and it self-dedupes to once per calendar day.
    checkAndNotify(bills, payoutSchedules, payoutDates).catch((error) => {
      console.error('Notification check failed:', error)
    })
  }, [bills, payoutSchedules, payoutDates])

  useEffect(() => {
    // Best-effort background snapshot: never let this block rendering or
    // surface an error to the user. Failures (e.g. IndexedDB unavailable)
    // are logged only.
    if (shouldTakeSnapshotToday()) {
      takeLocalSnapshot().catch((error) => {
        console.error('Background local snapshot failed:', error)
      })
    }
  }, [])

  if (locked) {
    return <LockScreen onUnlock={() => setLocked(false)} />
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Header title={titleFor(location.pathname)} />
      <UpdateToast />
      <main className="flex-1 overflow-y-auto pb-4">
        <Suspense fallback={<RouteFallback />}>
          <AnimatePresence mode="wait" initial={false}>
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<PageTransition><Dashboard /></PageTransition>} />
              <Route path="/add" element={<PageTransition><AddTransaction /></PageTransition>} />
              <Route path="/accounts" element={<PageTransition><Accounts /></PageTransition>} />
              <Route path="/budgets" element={<PageTransition><Budgets /></PageTransition>} />
              <Route path="/bills" element={<PageTransition><Bills /></PageTransition>} />
              <Route path="/transactions" element={<PageTransition><Transactions /></PageTransition>} />
              <Route path="/settings" element={<PageTransition><Settings /></PageTransition>} />
            </Routes>
          </AnimatePresence>
        </Suspense>
      </main>
      <StatusStrip />
      <CommandBar />
    </div>
  )
}

export default App
