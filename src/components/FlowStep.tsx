import { motion } from 'framer-motion'
import { stepVariants } from '../lib/motion'

export default function FlowStep({
  direction,
  children,
}: {
  direction: number
  children: React.ReactNode
}) {
  return (
    <motion.div
      custom={direction}
      variants={stepVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}
