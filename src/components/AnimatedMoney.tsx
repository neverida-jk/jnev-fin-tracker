import { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'
import { formatMoney } from '../lib/format'

// Every money figure gets the shared `tabular-money` treatment (tabular
// digits + a touch of negative tracking — see the @utility in index.css) so
// amounts don't jitter as they animate and read as bold, confident numerals.
// Size/weight stay caller-controlled via `className` (e.g. hero net worth at
// text-3xl font-bold vs. a small inline figure), since AnimatedMoney is used
// at very different scales across the app.
export default function AnimatedMoney({ value, className = '' }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(value)
  const prev = useRef(value)

  useEffect(() => {
    const controls = animate(prev.current, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setDisplay(latest),
    })
    prev.current = value
    return () => controls.stop()
  }, [value])

  return <span className={`tabular-money ${className}`}>{formatMoney(display)}</span>
}
