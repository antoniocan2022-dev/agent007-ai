'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface ScrollArrowsProps {
  /** The scrollable container ref to attach to */
  containerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * ScrollArrows — Floating up/down arrows for quick navigation in the conversation.
 *
 * UPGRADE #69 — Owner request: "Create arrow up and down, to go on top or down
 * in the conversation."
 *
 * Features:
 *   - Arrow UP (⬆): Scrolls to the top of the conversation (first message)
 *   - Arrow DOWN (⬇): Scrolls to the bottom of the conversation (latest message)
 *   - Arrows appear/disappear based on scroll position:
 *     - UP arrow shows when scrolled down past 200px
 *     - DOWN arrow shows when not at the bottom (scrolled up from latest)
 *   - Smooth scroll animation
 *   - Auto-hide after 3 seconds of inactivity
 *   - Dark glassmorphic style matching the NEXUS AI theme
 *   - Positioned bottom-right of the chat area (above the input)
 *   - Mobile-responsive (smaller on mobile)
 *   - Accessible (aria-labels, keyboard focusable)
 */
export function ScrollArrows({ containerRef }: ScrollArrowsProps) {
  const [showUp, setShowUp] = useState(false)
  const [showDown, setShowDown] = useState(false)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)

  const checkScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const isAtTop = scrollTop < 200
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 200

    setShowUp(!isAtTop && scrollHeight > clientHeight + 400)
    setShowDown(!isAtBottom && scrollHeight > clientHeight + 400)

    // Auto-hide after 3 seconds
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (!isAtTop || !isAtBottom) {
      hideTimerRef.current = setTimeout(() => {
        setShowUp(false)
        setShowDown(false)
      }, 3000)
    }
  }, [containerRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('scroll', checkScroll, { passive: true })
    // Check on mount + when messages change (via interval as a fallback)
    checkScroll()
    const interval = setInterval(checkScroll, 1000)

    return () => {
      container.removeEventListener('scroll', checkScroll)
      clearInterval(interval)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [containerRef, checkScroll])

  const scrollToTop = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    container.scrollTo({ top: 0, behavior: 'smooth' })
  }, [containerRef])

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }, [containerRef])

  const hasAnyArrow = showUp || showDown

  return (
    <AnimatePresence>
      {hasAnyArrow && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 10 }}
          transition={{ duration: 0.2 }}
          className="absolute bottom-4 right-4 z-40 flex flex-col gap-2"
        >
          {/* Arrow UP — scroll to top */}
          <AnimatePresence>
            {showUp && (
              <motion.button
                key="scroll-up"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.15 }}
                onClick={scrollToTop}
                aria-label="Scroll to top of conversation"
                title="Scroll to top"
                className="group flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-full glass border border-cyan-400/40 hover:border-cyan-400/70 hover:bg-cyan-400/15 transition-all shadow-lg shadow-cyan-500/10"
                style={{ touchAction: 'manipulation' }}
              >
                <ChevronUp className="w-5 h-5 text-cyan-300 group-hover:text-cyan-200 transition-colors" strokeWidth={2.5} />
                {/* Glow effect on hover */}
                <span className="absolute inset-0 rounded-full bg-cyan-400/0 group-hover:bg-cyan-400/5 blur-md transition-all" />
              </motion.button>
            )}
          </AnimatePresence>

          {/* Arrow DOWN — scroll to bottom */}
          <AnimatePresence>
            {showDown && (
              <motion.button
                key="scroll-down"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.15 }}
                onClick={scrollToBottom}
                aria-label="Scroll to bottom of conversation (latest messages)"
                title="Scroll to latest"
                className="group flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-full glass border border-purple-400/40 hover:border-purple-400/70 hover:bg-purple-400/15 transition-all shadow-lg shadow-purple-500/10"
                style={{ touchAction: 'manipulation' }}
              >
                <ChevronDown className="w-5 h-5 text-purple-300 group-hover:text-purple-200 transition-colors" strokeWidth={2.5} />
                {/* Glow effect on hover */}
                <span className="absolute inset-0 rounded-full bg-purple-400/0 group-hover:bg-purple-400/5 blur-md transition-all" />
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
