'use client'

import { motion } from 'framer-motion'
import { User, Paperclip, FileText, Image as ImageIcon } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { ChatMessage } from '@/store/chat-store'
import { ReasoningTimeline } from './reasoning-timeline'
import { ReasoningPanel } from './reasoning-panel'
import { HexAvatar } from './nexus-logo'
import type { AttachmentMeta } from '@/lib/tools'

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex justify-end gap-3 mb-6"
      >
        <div className="flex-1 flex flex-col items-end max-w-[85%]">
          <div className="text-[10px] label-tag mb-1">YOU</div>
          <div className="glass rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-[#e0e7ff]">
            {message.content && <div className="whitespace-pre-wrap">{message.content}</div>}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {message.attachments.map((a, i) => (
                  <AttachmentChip key={i} att={a} />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center text-cyan-300">
          <User className="w-4 h-4" />
        </div>
      </motion.div>
    )
  }

  // Assistant
  const isEmpty = !message.content && (!message.steps || message.steps.length === 0) && !message.reasoning
  const isStreaming = message.isStreaming
  const showCaret = isStreaming && !message.content

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex gap-3 mb-8"
    >
      <div className="flex-shrink-0 mt-1">
        <HexAvatar size={36} pulse={isStreaming} />
      </div>
      <div className="flex-1 min-w-0 max-w-[760px]">
        <div className="text-[10px] label-tag mb-1 flex items-center gap-2">
          Agent007 AI
          {isStreaming && (
            <span className="inline-flex items-center gap-1 text-[9px] text-cyan-300">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </span>
          )}
        </div>

        <ReasoningTimeline steps={message.steps} />

        {/* UPGRADE #119 — Show LLM reasoning in a collapsible panel */}
        {message.reasoning && (
          <ReasoningPanel reasoning={message.reasoning} isStreaming={isStreaming} />
        )}

        {isEmpty && showCaret ? (
          <div className="glass rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-[#7c89b5] italic flex items-center gap-2">
            <span>Initializing agent loop…</span>
          </div>
        ) : message.content ? (
          <div
            className={`glass rounded-2xl rounded-tl-sm px-4 py-3 ${
              isStreaming ? 'stream-caret' : ''
            }`}
          >
            <div className="prose-agent007">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          </div>
        ) : null}
      </div>
    </motion.div>
  )
}

function AttachmentChip({ att }: { att: AttachmentMeta }) {
  const isImage = att.mimeType.startsWith('image/') || att.dataUrl
  if (isImage && att.dataUrl) {
    return (
      <a href={att.dataUrl} target="_blank" rel="noreferrer" className="block group">
        <img
          src={att.dataUrl}
          alt={att.originalName}
          className="w-24 h-24 object-cover rounded-md border border-cyan-400/30 group-hover:border-cyan-400/70 transition"
        />
        <div className="text-[9px] text-[#7c89b5] mt-0.5 truncate max-w-[96px]">
          {att.originalName}
        </div>
      </a>
    )
  }
  const isText = /\.(txt|md|csv|json|js|ts|tsx|jsx|html|css|xml|yaml|yml|log|py|go|rs|java|c|cpp|h)$/i.test(
    att.originalName
  )
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-cyan-400/5 border border-cyan-400/20 text-xs text-[#9bb5d4] max-w-[220px]">
      {isText ? <FileText className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" /> : <Paperclip className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" />}
      <span className="truncate">{att.originalName}</span>
      <span className="text-[9px] text-[#7c89b5] flex-shrink-0">{(att.size / 1024).toFixed(1)}KB</span>
    </div>
  )
}
