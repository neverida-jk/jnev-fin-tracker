import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import Header from './components/Header'
import PageTransition from './components/PageTransition'
import CommandBar from './components/CommandBar'
import StatusStrip from './components/StatusStrip'
import { seedIfEmpty } from './db'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const AddTransaction = lazy(() => import('./pages/AddTransaction'))
const Accounts = lazy(() => import('./pages/Accounts'))
const Budgets = lazy(() => import('./pages/Budgets'))
const Bills = lazy(() => import('./pages/Bills'))
const Settings = lazy(() => import('./pages/Settings'))

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/add': 'Add Transaction',
  '/accounts': 'Accounts',
  '/budgets': 'Budgets',
  '/bills': 'Bills & Payouts',
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

  useEffect(() => {
    seedIfEmpty()
  }, [])

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Header title={titleFor(location.pathname)} />
      <main className="flex-1 overflow-y-auto pb-4">
        <Suspense fallback={<RouteFallback />}>
          <AnimatePresence mode="wait" initial={false}>
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<PageTransition><Dashboard /></PageTransition>} />
              <Route path="/add" element={<PageTransition><AddTransaction /></PageTransition>} />
              <Route path="/accounts" element={<PageTransition><Accounts /></PageTransition>} />
              <Route path="/budgets" element={<PageTransition><Budgets /></PageTransition>} />
              <Route path="/bills" element={<PageTransition><Bills /></PageTransition>} />
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
