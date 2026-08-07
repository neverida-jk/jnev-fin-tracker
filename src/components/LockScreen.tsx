import { useState } from 'react'
import { motion } from 'framer-motion'
import { Lock } from 'lucide-react'
import { disableLock, verifyPin } from '../lib/appLock'
import { tapScale } from '../lib/motion'

/** Full-screen gate shown on cold start (if a PIN is set) and again every
 * time the app is backgrounded — see App.tsx's visibilitychange handler.
 * "Forgot PIN?" is a real, no-questions-asked reset because this is a
 * screen lock, not encryption (see appLock.ts) — turning it off can't lose
 * any financial data. */
export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (await verifyPin(pin)) {
      onUnlock()
    } else {
      setError('Incorrect PIN.')
      setPin('')
    }
  }

  function handleForgot() {
    disableLock()
    onUnlock()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-slate-950 px-6 text-center text-white">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-400">
        <Lock size={26} />
      </div>
      <div>
        <p className="text-lg font-semibold">Enter your PIN</p>
        <p className="mt-1 text-sm text-slate-400">Unlock to see your accounts</p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-3">
        <label htmlFor="lock-pin" className="sr-only">
          PIN
        </label>
        <input
          id="lock-pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoFocus
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ''))
            setError(null)
          }}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-center text-lg tracking-[0.5em] text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        />
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <motion.button
          {...tapScale}
          type="submit"
          disabled={pin.length < 4}
          className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold disabled:opacity-40"
        >
          Unlock
        </motion.button>
      </form>

      {!confirmingReset ? (
        <button
          type="button"
          onClick={() => setConfirmingReset(true)}
          className="text-xs text-slate-500 underline underline-offset-2"
        >
          Forgot PIN?
        </button>
      ) : (
        <div className="max-w-xs text-xs text-slate-400">
          <p className="mb-2">This turns the app lock off — your accounts and transactions aren't touched.</p>
          <div className="flex justify-center gap-4">
            <button type="button" onClick={() => setConfirmingReset(false)} className="underline underline-offset-2">
              Cancel
            </button>
            <button type="button" onClick={handleForgot} className="text-red-400 underline underline-offset-2">
              Turn off lock
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
