import { motion, type HTMLMotionProps } from 'framer-motion'
import { forwardRef } from 'react'

type CardProps = HTMLMotionProps<'div'> & {
  tone?: 'default' | 'dark' | 'amber'
}

// Shared tone family: "default"/"amber" are quiet, near-flat surfaces with a
// soft shadow; "dark" (the net-worth hero) gets a deep gradient plus a
// colored ambient glow and a touch more radius, matching Tile's "dark"/
// "solid" tones so hero elements feel like one consistent system.
const tones: Record<NonNullable<CardProps['tone']>, string> = {
  default:
    'rounded-2xl bg-white border-slate-200/70 shadow-md shadow-slate-900/5 dark:bg-slate-800/80 dark:border-slate-700/60 dark:shadow-black/20',
  dark: 'rounded-3xl bg-linear-to-br from-slate-800 via-slate-950 to-indigo-950 border-white/5 text-white shadow-xl shadow-indigo-950/50',
  amber:
    'rounded-2xl bg-amber-50 border-amber-300/70 shadow-md shadow-amber-900/5 dark:bg-amber-950/60 dark:border-amber-700/60 dark:shadow-black/20',
}

const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone = 'default', className = '', children, ...props },
  ref,
) {
  return (
    <motion.div ref={ref} className={`border p-4 ${tones[tone]} ${className}`} {...props}>
      {children}
    </motion.div>
  )
})

export default Card
