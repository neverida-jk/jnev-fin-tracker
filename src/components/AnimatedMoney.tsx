import { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'
import { formatMoney } from '../lib/format'

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

  return <span className={className}>{formatMoney(display)}</span>
}
