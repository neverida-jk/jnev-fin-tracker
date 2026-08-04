import { Link, useLocation } from 'react-router-dom'
import { Home, Settings } from 'lucide-react'

export default function Header({ title }: { title: string }) {
  const location = useLocation()
  const onSettings = location.pathname === '/settings'
  const onHome = location.pathname === '/'

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="flex items-center gap-1.5">
        {!onHome && (
          <Link
            to="/"
            aria-label="Home"
            className="-ml-1.5 rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <Home size={20} />
          </Link>
        )}
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
      </div>
      {!onSettings && (
        <Link
          to="/settings"
          aria-label="Settings"
          className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <Settings size={20} />
        </Link>
      )}
    </header>
  )
}
