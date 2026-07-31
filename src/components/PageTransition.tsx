import { motion } from 'framer-motion'
import { pagefade } from '../lib/motion'

export default function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={pagefade.initial}
      animate={pagefade.animate}
      exit={pagefade.exit}
      transition={pagefade.transition}
    >
      {children}
    </motion.div>
  )
}
