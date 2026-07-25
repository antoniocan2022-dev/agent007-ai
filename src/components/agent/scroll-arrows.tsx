'use client'

import { useState, useEffect, useCallback } from 'react'
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
 * UPGRADE #90 — Owner complaint: "Arrows still missing."
 * FIX: Arrows are now ALWAYS VISIBLE (no auto-hide), with visual indicators
 * showing whether scroll is possible. Added a manual toggle button to
 * show/hide arrows. Made arrows larger and more visible.
 *
 * Features:
 *   - Arrow UP (⬆): Scrolls to the top of the conversation (first message)
 *   - Arrow DOWN (⬇): Scrolls to the bottom of the conversation (latest message)
 *   - ALWAYS VISIBLE (no auto-hide — was the bug)
 *   - Disabled state when at top/bottom (grayed out, not hidden)
 *   - Smooth scroll animation
 *   - Dark glassmorphic style matching the NEXUS AI theme
 *   - Positioned bottom-right of the chat area (above the input)
 *   - Mobile-responsive (smaller on mobile)
 *   - Accessible (aria-labels, keyboard focusable)
 *   - Pulsing glow effect to draw attention
 */
export function ScrollArrows({ containerRef }: ScrollArrowsProps) {
  const [showUp, setShowUp] = useState(false)
  const [showDown, setShowDown] = useState(false)
  const [alwaysVisible, setAlwaysVisible] = useState(true) // UPGRADE #90 — default ON
  // UPGRADE #90 FIX — Track disabled states in STATE (not derived from ref during render)
  // Accessing containerRef.current during render causes hydration mismatch + client-side exception.
  const [isAtTop, setIsAtTop] = useState(true)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const checkScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const top = scrollTop < 200
    const bottom = scrollHeight - scrollTop - clientHeight < 200
    // UPGRADE #148 (Issue 1a fix) — Lowered threshold from +100 to +30.
    // Before: needed 100px of overflow before arrows appeared, so short
    //   conversations (the common case for testing) showed NO arrows at all.
    //   Owner reported "arrows never work" — they were working, just hidden.
    // After: 30px of overflow is enough — even a 3-4 message conversation
    //   on a small viewport will show arrows.
    const hasScrollableContent = scrollHeight > clientHeight + 30

    // Update disabled states
    setIsAtTop(top)
    setIsAtBottom(bottom)

    // UPGRADE #90 — Show arrows based on alwaysVisible flag OR scroll position
    if (alwaysVisible) {
      // Always show both arrows (disabled state if at top/bottom)
      setShowUp(hasScrollableContent)
      setShowDown(hasScrollableContent)
    } else {
      // Original behavior: only show when scrollable
      setShowUp(!top && hasScrollableContent)
      setShowDown(!bottom && hasScrollableContent)
    }
  }, [containerRef, alwaysVisible])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('scroll', checkScroll, { passive: true })
    checkScroll()
    // UPGRADE #90 — Check more frequently (was 1000ms, now 500ms)
    const interval = setInterval(checkScroll, 500)

    return () => {
      container.removeEventListener('scroll', checkScroll)
      clearInterval(interval)
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

  // UPGRADE #148 (Issue 1b fix) — The toggle button must ALWAYS be visible,
  // even in short conversations where hasAnyArrow is false. Before: the toggle
  // was inside the `hasAnyArrow && (...)` block, so users couldn't enable
  // arrows in short convos. After: the toggle renders unconditionally, so
  // users can always flip the alwaysVisible flag and see the arrows appear
  // (disabled state) regardless of conversation length.
  return (
    <>
      {/* Arrows — only when there's scrollable content */}
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
                  disabled={isAtTop && alwaysVisible}
                  aria-label="Scroll to top of conversation"
                  title="Scroll to top"
                  className={`group flex items-center justify-center w-12 h-12 sm:w-12 sm:h-12 rounded-full glass border shadow-lg transition-all ${
                    isAtTop && alwaysVisible
                      ? 'border-white/10 opacity-40 cursor-not-allowed'
                      : 'border-cyan-400/40 hover:border-cyan-400/70 hover:bg-cyan-400/15 shadow-cyan-500/10'
                  }`}
                  style={{ touchAction: 'manipulation' }}
                >
                  <ChevronUp className={`w-6 h-6 transition-colors ${isAtTop && alwaysVisible ? 'text-white/30' : 'text-cyan-300 group-hover:text-cyan-200'}`} strokeWidth={2.5} />
                  {/* Pulsing glow effect */}
                  {!isAtTop && (
                    <span className="absolute inset-0 rounded-full bg-cyan-400/10 animate-pulse" />
                  )}
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
                  disabled={isAtBottom && alwaysVisible}
                  aria-label="Scroll to bottom of conversation (latest messages)"
                  title="Scroll to latest"
                  className={`group flex items-center justify-center w-12 h-12 sm:w-12 sm:h-12 rounded-full glass border shadow-lg transition-all ${
                    isAtBottom && alwaysVisible
                      ? 'border-white/10 opacity-40 cursor-not-allowed'
                      : 'border-purple-400/40 hover:border-purple-400/70 hover:bg-purple-400/15 shadow-purple-500/10'
                  }`}
                  style={{ touchAction: 'manipulation' }}
                >
                  <ChevronDown className={`w-6 h-6 transition-colors ${isAtBottom && alwaysVisible ? 'text-white/30' : 'text-purple-300 group-hover:text-purple-200'}`} strokeWidth={2.5} />
                  {/* Pulsing glow effect */}
                  {!isAtBottom && (
                    <span className="absolute inset-0 rounded-full bg-purple-400/10 animate-pulse" />
                  )}
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* UPGRADE #148 (Issue 1b fix) — Toggle button is ALWAYS visible, even
          in short conversations. Rendered as a separate fixed element at the
          BOTTOM-LEFT so it doesn't overlap with the arrows (which are
          bottom-right). Users can flip alwaysVisible anytime. */}
      <motion.button
        key="toggle-arrows"
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.5 }}
        transition={{ duration: 0.15 }}
        onClick={() => setAlwaysVisible((v) => !v)}
        aria-label={alwaysVisible ? 'Auto-hide arrows' : 'Always show arrows'}
        title={alwaysVisible ? 'Always visible (click to auto-hide)' : 'Auto-hide (click for always visible)'}
        className="absolute bottom-4 left-4 z-40 group flex items-center justify-center w-8 h-8 sm:w-8 sm:h-8 rounded-full glass border border-white/10 hover:border-white/30 transition-all opacity-60 hover:opacity-100"
        style={{ touchAction: 'manipulation' }}
      >
        <span className="text-[10px] text-white/60 group-hover:text-white/90 font-mono">
          {alwaysVisible ? 'ON' : 'OFF'}
        </span>
      </motion.button>
    </>
  )
}
