'use client'

import { useChatStore } from '@/store/chat-store'
import { Activity, Loader2, Clock, Wrench, Brain } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * AgentProgressBanner — Real-time progress indicator for the super agent.
 *
 * UPGRADE #63 — Fixes the owner complaint:
 * "In long conversation he stops, I dont know he is working or not,
 * sometimes I write words like 'OK' or 'Finish' to know if is working or not."
 *
 * Shows a sticky banner at the top of the chat area when the agent is running:
 *   - Iteration count: "Step 3/50"
 *   - Tools called: "5 tools called"
 *   - Last tool: "Last: web_search"
 *   - Elapsed time: "12s elapsed"
 *   - Last thought: "Searching for affiliate programs..."
 *   - Animated spinner + pulse effect
 *
 * When the agent is idle, the banner is hidden.
 */
export function AgentProgressBanner() {
  const status = useChatStore((s) => s.status)
  const heartbeat = useChatStore((s) => s.heartbeat)

  const isRunning = status === 'thinking' || status === 'tool_running' || status === 'streaming'

  return (
    <AnimatePresence>
      {isRunning && heartbeat && (
        <motion.div
          initial={{ opacity: 0, y: -10, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -10, height: 0 }}
          transition={{ duration: 0.2 }}
          className="sticky top-0 z-30 bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-pink-500/10 backdrop-blur-md border-b border-cyan-400/30"
        >
          <div className="px-4 py-2.5 flex items-center gap-4 flex-wrap">
            {/* Animated spinner */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-300" />
              <Activity className="w-4 h-4 text-cyan-300 animate-pulse" />
              <span className="text-xs font-bold text-cyan-200 tracking-wider">
                AGENT WORKING
              </span>
              {/* UPGRADE #119 — Show "Thinking…" when the agent is in reasoning mode */}
              {status === 'thinking' && (
                <span className="inline-flex items-center gap-1 text-[10px] text-purple-300 bg-purple-400/10 border border-purple-400/30 px-2 py-0.5 rounded-full ml-1">
                  <Brain className="w-3 h-3 animate-pulse" />
                  THINKING…
                </span>
              )}
            </div>

            {/* Progress: iteration / maxIterations */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[#7c89b5]">Step</span>
              <span className="font-bold text-cyan-200">
                {heartbeat.iteration}/{heartbeat.maxIterations}
              </span>
            </div>

            {/* Tools called */}
            <div className="flex items-center gap-1.5 text-xs">
              <Wrench className="w-3 h-3 text-purple-300" />
              <span className="text-[#7c89b5]">Tools:</span>
              <span className="font-bold text-purple-200">{heartbeat.toolsCalled}</span>
            </div>

            {/* Last tool name */}
            {heartbeat.lastToolName && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-[#7c89b5]">Last:</span>
                <span className="font-mono text-pink-200 bg-pink-400/10 px-1.5 py-0.5 rounded">
                  {heartbeat.lastToolName}
                </span>
              </div>
            )}

            {/* Elapsed time */}
            <div className="flex items-center gap-1.5 text-xs ml-auto">
              <Clock className="w-3 h-3 text-cyan-300" />
              <span className="font-mono text-cyan-200">
                {(heartbeat.elapsedMs / 1000).toFixed(1)}s
              </span>
            </div>
          </div>

          {/* Last thought (truncated) */}
          {heartbeat.lastThought && (
            <div className="px-4 pb-2 -mt-1">
              <p className="text-[11px] text-[#7c89b5] italic truncate">
                💭 {heartbeat.lastThought}
              </p>
            </div>
          )}

          {/* Progress bar */}
          <div className="h-0.5 bg-cyan-400/20 overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-cyan-400 to-purple-400"
              initial={{ width: '0%' }}
              animate={{
                width: `${(heartbeat.iteration / heartbeat.maxIterations) * 100}%`,
              }}
              transition={{ duration: 0.3 }}
            />
          </div>

          {/* Message */}
          <div className="px-4 py-1">
            <p className="text-[10px] text-[#5a6388] tracking-wide">
              {heartbeat.message} — agent is alive and executing
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
