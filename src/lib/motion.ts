import type { Variants } from 'framer-motion'

export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.02 },
  },
}

export const fadeUpItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
}

export const collapseItem: Variants = {
  hidden: { opacity: 0, height: 0 },
  show: { opacity: 1, height: 'auto', transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, height: 0, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
}

export const pagefade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const },
}

export const tapScale = {
  whileTap: { scale: 0.97 },
}

// Wizard-style step transitions: enters from the direction you're moving
// toward, exits toward the direction you came from.
export const stepVariants = {
  enter: (direction: number) => ({ x: direction >= 0 ? 24 : -24, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction >= 0 ? -24 : 24, opacity: 0 }),
}
