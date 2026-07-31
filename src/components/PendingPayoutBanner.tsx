import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Wallet2 } from 'lucide-react'
import db from '../db'
import { getPendingPayoutDates } from '../lib/payout'
import { parseISODate } from '../lib/dates'

export default function PendingPayoutBanner() {
  const navigate = useNavigate()
  const schedules = useLiveQuery(() => db.payoutSchedules.toArray(), [], [])
  const payoutDates = useLiveQuery(() => db.payoutDates.toArray(), [], [])
  const pending = getPendingPayoutDates(schedules ?? [], payoutDates ?? [])

  return (
    <div className="mx-4 mt-4 space-y-2">
      <AnimatePresence initial={false}>
        {pending.map(({ schedule, payoutDate }) => (
          <motion.button
            key={payoutDate.id}
            layout
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate(`/add?payoutDateId=${payoutDate.id}`)}
            className="flex w-full items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-left shadow-sm shadow-amber-900/5 dark:border-amber-700 dark:bg-amber-950"
          >
            <motion.div
              animate={{ scale: [1, 1.12, 1] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              className="shrink-0"
            >
              <Wallet2 className="text-amber-600 dark:text-amber-400" size={22} />
            </motion.div>
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                {schedule.label} payout expected{' '}
                {parseISODate(payoutDate.date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">Tap to log the amount</p>
            </div>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
