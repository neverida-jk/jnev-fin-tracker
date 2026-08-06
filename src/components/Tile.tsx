import { motion, type HTMLMotionProps } from 'framer-motion'
import { useNavigate } from 'react-router-dom'

type TileProps = Omit<HTMLMotionProps<'button'>, 'onClick'> & {
  to: string
  tone?: 'default' | 'dark' | 'amber' | 'solid'
}

// Same family as Card's tones (see Card.tsx) plus "solid" for primary CTAs
// (e.g. Add transaction) — a vibrant version of the same brand gradient used
// by "dark", with its own colored glow instead of the neutral default shadow.
const tones: Record<NonNullable<TileProps['tone']>, string> = {
  default:
    'rounded-2xl bg-white border-slate-200/70 shadow-md shadow-slate-900/5 dark:bg-slate-800/80 dark:border-slate-700/60 dark:shadow-black/20',
  dark: 'rounded-3xl bg-linear-to-br from-slate-800 via-slate-950 to-indigo-950 border-white/5 text-white shadow-xl shadow-indigo-950/50',
  amber:
    'rounded-2xl bg-amber-50 border-amber-300/70 shadow-md shadow-amber-900/5 dark:bg-amber-950/60 dark:border-amber-700/60 dark:shadow-black/20',
  solid: 'rounded-3xl bg-linear-to-br from-brand-from to-brand-to border-white/10 text-white shadow-xl shadow-violet-900/40',
}

export default function Tile({ to, tone = 'default', className = '', children, ...props }: TileProps) {
  const navigate = useNavigate()
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={() => navigate(to)}
      className={`flex flex-col border p-4 text-left ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </motion.button>
  )
}
