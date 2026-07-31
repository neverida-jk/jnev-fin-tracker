import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LayoutDashboard, PlusCircle, Wallet, PiggyBank, CalendarClock, BarChart3 } from 'lucide-react'

const items = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/add', label: 'Add', icon: PlusCircle, end: false },
  { to: '/accounts', label: 'Accounts', icon: Wallet, end: false },
  { to: '/budgets', label: 'Budgets', icon: PiggyBank, end: false },
  { to: '/bills', label: 'Bills', icon: CalendarClock, end: false },
  { to: '/reports', label: 'Reports', icon: BarChart3, end: false },
]

export default function BottomNav() {
  return (
    <nav className="sticky bottom-0 z-10 grid grid-cols-6 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${
              isActive
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-slate-500 dark:text-slate-400'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-indigo-600 dark:bg-indigo-400"
                  transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                />
              )}
              <motion.span whileTap={{ scale: 0.85 }}>
                <Icon size={20} strokeWidth={2} />
              </motion.span>
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
