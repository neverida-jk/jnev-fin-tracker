import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import Header from './components/Header'
import PageTransition from './components/PageTransition'
import CommandBar from './components/CommandBar'
import Dashboard from './pages/Dashboard'
import AddTransaction from './pages/AddTransaction'
import Accounts from './pages/Accounts'
import Budgets from './pages/Budgets'
import Bills from './pages/Bills'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import { seedIfEmpty } from './db'

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/add': 'Add Transaction',
  '/accounts': 'Accounts',
  '/budgets': 'Budgets',
  '/bills': 'Bills & Payouts',
  '/reports': 'Reports',
  '/settings': 'Settings',
}

function titleFor(pathname: string): string {
  return titles[pathname] ?? 'Finance Tracker'
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
        <AnimatePresence mode="wait" initial={false}>
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<PageTransition><Dashboard /></PageTransition>} />
            <Route path="/add" element={<PageTransition><AddTransaction /></PageTransition>} />
            <Route path="/accounts" element={<PageTransition><Accounts /></PageTransition>} />
            <Route path="/budgets" element={<PageTransition><Budgets /></PageTransition>} />
            <Route path="/bills" element={<PageTransition><Bills /></PageTransition>} />
            <Route path="/reports" element={<PageTransition><Reports /></PageTransition>} />
            <Route path="/settings" element={<PageTransition><Settings /></PageTransition>} />
          </Routes>
        </AnimatePresence>
      </main>
      <CommandBar />
    </div>
  )
}

export default App
