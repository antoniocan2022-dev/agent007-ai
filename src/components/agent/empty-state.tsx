'use client'

import { motion } from 'framer-motion'
import { NexusLogo } from './nexus-logo'

export function EmptyState({ onPick: _onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 py-10 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="hex-pulse mb-5"
      >
        <NexusLogo size={96} />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.35 }}
        className="text-3xl sm:text-4xl font-extrabold tracking-tight"
      >
        <span className="neon-text-cyan">CEO_</span>
        <span className="neon-text-purple">Agent007</span>
      </motion.h1>
    </div>
  )
}
