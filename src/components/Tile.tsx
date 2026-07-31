import { motion, type HTMLMotionProps } from 'framer-motion'
import { useNavigate } from 'react-router-dom'

type TileProps = Omit<HTMLMotionProps<'button'>, 'onClick'> & {
  to: string
  tone?: 'default' | 'dark' | 'amber' | 'solid'
}

const tones: Record<NonNullable<TileProps['tone']>, string> = {
  default: 'bg-white dark:bg-slate-800/80 border-slate-200/70 dark:border-slate-700/60',
  dark: 'bg-slate-900 dark:bg-slate-950 border-slate-800 text-white',
  amber: 'bg-amber-50 dark:bg-amber-950/60 border-amber-300/70 dark:border-amber-700/60',
  solid: 'bg-indigo-600 border-indigo-600 text-white',
}

export default function Tile({ to, tone = 'default', className = '', children, ...props }: TileProps) {
  const navigate = useNavigate()
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={() => navigate(to)}
      className={`flex flex-col rounded-2xl border p-4 text-left shadow-sm shadow-slate-900/5 dark:shadow-black/20 ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </motion.button>
  )
}
