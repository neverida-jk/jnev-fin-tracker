import { motion } from 'framer-motion'
import type { ACCOUNT_ICONS } from '../lib/accountIcons'

export interface PickerItem {
  id: number
  label: string
  dotColor?: string
  icon?: (typeof ACCOUNT_ICONS)[keyof typeof ACCOUNT_ICONS]
}

export default function PickerGrid({
  title,
  items,
  onPick,
}: {
  title: string
  items: PickerItem[]
  onPick: (id: number) => void
}) {
  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-400">
        Choose {title.toLowerCase()}
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <motion.button
              key={item.id}
              whileTap={{ scale: 0.95 }}
              onClick={() => onPick(item.id)}
              className="flex flex-col items-center gap-2 rounded-xl border border-slate-200/80 bg-white py-4 text-sm font-medium text-slate-700 shadow-sm shadow-slate-900/5 transition-colors hover:border-indigo-200 hover:bg-indigo-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/40"
            >
              {Icon ? (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                  <Icon size={18} />
                </div>
              ) : (
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.dotColor }} />
              )}
              <span className="truncate px-1">{item.label}</span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
