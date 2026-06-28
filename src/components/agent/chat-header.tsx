'use client'

import { Menu, PanelLeft, PanelRight, Globe, ShieldCheck } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import { NexusLogo } from './nexus-logo'

export function ChatHeader({
  onToggleLeft,
  onToggleRight,
}: {
  onToggleLeft: () => void
  onToggleRight: () => void
}) {
  const language = useChatStore((s) => s.language)
  const setLanguage = useChatStore((s) => s.setLanguage)
  const status = useChatStore((s) => s.status)

  return (
    <header className="sticky top-0 z-30 glass-strong border-b border-cyan-400/15 px-3 sm:px-4 py-2.5 flex items-center gap-3">
      {/* left toggle (mobile) */}
      <button
        onClick={onToggleLeft}
        className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-cyan-300 hover:bg-cyan-400/10"
        aria-label="Toggle conversations"
      >
        <Menu className="w-4 h-4" />
      </button>
      <button
        onClick={onToggleLeft}
        className="hidden md:flex w-9 h-9 rounded-lg items-center justify-center text-cyan-300 hover:bg-cyan-400/10"
        aria-label="Toggle left sidebar"
        title="Toggle left sidebar"
      >
        <PanelLeft className="w-4 h-4" />
      </button>

      {/* logo / title */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="hidden sm:block">
          <NexusLogo size={28} />
        </div>
        <div className="leading-tight min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold tracking-tight">
              <span className="neon-text-cyan">NEXUS</span>{' '}
              <span className="neon-text-purple">AI</span>
            </h1>
            <span className="hidden sm:inline-flex text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-400/10 border border-cyan-400/30 text-cyan-200 tracking-wider">
              SUPER AGENT
            </span>
          </div>
          <div className="text-[9px] text-[#5b6a92] tracking-wide hidden sm:block">
            {status === 'idle'
              ? 'Ready • GLM-4.5 + tools'
              : status === 'thinking'
              ? 'Reasoning…'
              : status === 'tool_running'
              ? 'Executing tools…'
              : 'Streaming response…'}
          </div>
        </div>
      </div>

      {/* language toggle */}
      <button
        onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
        className="h-9 px-3 rounded-lg text-[11px] font-semibold tracking-wider glass border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 transition flex items-center gap-1.5"
        title="Toggle reply language"
        aria-label="Toggle language"
      >
        <Globe className="w-3.5 h-3.5" />
        <span className={language === 'en' ? 'text-cyan-300' : 'text-[#7c89b5]'}>EN</span>
        <span className="text-[#5b6a92]">/</span>
        <span className={language === 'zh' ? 'text-purple-300' : 'text-[#7c89b5]'}>中文</span>
      </button>

      {/* capabilities badge (desktop) */}
      <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg glass border-cyan-400/20 text-[10px] text-[#9bb5d4]">
        <ShieldCheck className="w-3 h-3 text-cyan-300" />
        <span>8 tools • bilingual • self-learning</span>
      </div>

      {/* right toggle */}
      <button
        onClick={onToggleRight}
        className="hidden md:flex w-9 h-9 rounded-lg items-center justify-center text-cyan-300 hover:bg-cyan-400/10"
        aria-label="Toggle right sidebar"
        title="Toggle telemetry panel"
      >
        <PanelRight className="w-4 h-4" />
      </button>
      <button
        onClick={onToggleRight}
        className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-cyan-300 hover:bg-cyan-400/10"
        aria-label="Toggle telemetry"
      >
        <PanelRight className="w-4 h-4" />
      </button>
    </header>
  )
}
