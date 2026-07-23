'use client'

/**
 * ReasoningPanel — UPGRADE #119
 * Displays the LLM's chain-of-thought reasoning in a collapsible section.
 *
 * When the agent produces reasoning (either from the LLM's native thinking
 * mode OR from the <thought> tags), it's shown here in a collapsible panel
 * above the final answer.
 *
 * This builds trust — the owner can see WHY the agent reached its conclusion.
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, ChevronDown, Lightbulb } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

interface ReasoningPanelProps {
  reasoning: string
  isStreaming?: boolean
}

export function ReasoningPanel({ reasoning, isStreaming }: ReasoningPanelProps) {
  const [expanded, setExpanded] = useState(false)

  if (!reasoning || !reasoning.trim()) return null

  // Truncate preview for collapsed state
  const preview = reasoning.slice(0, 150).trim()
  const hasMore = reasoning.length > 150

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-2"
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/5 border border-purple-400/20 hover:bg-purple-500/10 hover:border-purple-400/40 transition text-left group"
      >
        <Brain className={`w-3.5 h-3.5 text-purple-300 flex-shrink-0 ${isStreaming ? 'animate-pulse' : ''}`} />
        <span className="text-[11px] font-bold text-purple-200 tracking-wide flex-shrink-0">
          {isStreaming ? 'THINKING…' : 'REASONING'}
        </span>
        {!expanded && (
          <span className="text-[11px] text-[#9bb5d4] truncate flex-1 italic">
            {preview}{hasMore ? '…' : ''}
          </span>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 text-purple-300 flex-shrink-0 transition-transform ml-auto ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-1 px-3 py-2.5 rounded-lg bg-purple-500/[0.03] border border-purple-400/15 text-[12px] text-[#a5b4fc] leading-relaxed">
              <div className="flex items-center gap-1.5 mb-1.5 text-[10px] text-purple-300/70 uppercase tracking-wider font-bold">
                <Lightbulb className="w-3 h-3" />
                Chain-of-Thought Reasoning
              </div>
              <div className="prose-agent007 prose-sm max-w-none whitespace-pre-wrap text-[#a5b4fc]">
                {reasoning}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
