'use client'

import { motion } from 'framer-motion'

export function EmptyState({ onPick: _onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 py-10 text-center">
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="text-3xl sm:text-4xl font-extrabold tracking-tight"
      >
        <span className="neon-text-cyan">CEO_AGENT007</span>
      </motion.h1>
    </div>
  )
}
