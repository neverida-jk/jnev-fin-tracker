import { motion, type HTMLMotionProps } from 'framer-motion'
import { forwardRef } from 'react'

type CardProps = HTMLMotionProps<'div'> & {
  tone?: 'default' | 'dark' | 'amber'
}

const tones: Record<NonNullable<CardProps['tone']>, string> = {
  default: 'bg-white dark:bg-slate-800/80 border-slate-200/70 dark:border-slate-700/60',
  dark: 'bg-slate-900 dark:bg-slate-950 border-slate-800 text-white',
  amber: 'bg-amber-50 dark:bg-amber-950/60 border-amber-300/70 dark:border-amber-700/60',
}

const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone = 'default', className = '', children, ...props },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      className={`rounded-2xl border p-4 shadow-sm shadow-slate-900/5 dark:shadow-black/20 ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </motion.div>
  )
})

export default Card
