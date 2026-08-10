'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Paperclip, ArrowUp, Square, X, FileText, Mic } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import type { AttachmentMeta } from '@/lib/tools'

export function ChatInput() {
  const [text, setText] = useState('')
  const [uploading, setUploading] = useState(false)
  const [listening, setListening] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)
  const language = useChatStore((s) => s.language)
  const setLanguage = useChatStore((s) => s.setLanguage)
  const attachments = useChatStore((s) => s.attachments)
  const addAttachment = useChatStore((s) => s.addAttachment)
  const removeAttachment = useChatStore((s) => s.removeAttachment)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const stopStreaming = useChatStore((s) => s.stopStreaming)
  const status = useChatStore((s) => s.status)
  const isBusy = status !== 'idle'

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [text])

  useEffect(() => () => recognitionRef.current?.stop?.(), [])

  const handleSend = useCallback(() => {
    const t = text.trim()
    if (!t && attachments.length === 0) return
    if (isBusy) return
    setText('')
    sendMessage(t)
  }, [text, attachments, isBusy, sendMessage])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const toggleVoice = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Voice input is not supported by this browser.')
      return
    }
    if (listening) {
      recognitionRef.current?.stop?.()
      setListening(false)
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = language === 'en' ? 'en-CA' : 'es-CA'
    recognition.interimResults = true
    recognition.continuous = false
    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript
      setText(transcript)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        if (file.size > 8 * 1024 * 1024) {
          alert(`File "${file.name}" is too large for the current upload path (max 8MB). Large-file support is being migrated to object storage.`)
          continue
        }
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        if (!res.ok) {
          alert(`Upload failed for ${file.name}`)
          continue
        }
        const meta: AttachmentMeta = await res.json()
        addAttachment(meta)
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="px-3 sm:px-4 pb-3 pt-2">
      <div className="max-w-[820px] mx-auto">
        {attachments.length > 0 && <div className="mb-2 flex flex-wrap gap-2 px-1">{attachments.map((a) => <div key={a.filename} className="relative group flex items-center gap-2 px-2 py-1 rounded-md glass text-xs text-[#9bb5d4] max-w-[260px]">{a.mimeType.startsWith('image/') && a.dataUrl ? <img src={a.dataUrl} alt={a.originalName} className="w-7 h-7 object-cover rounded" /> : <FileText className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" />}<span className="truncate max-w-[160px]">{a.originalName}</span><button onClick={() => removeAttachment(a.filename)} className="text-[#7c89b5] hover:text-pink-300" aria-label={`Remove ${a.originalName}`}><X className="w-3 h-3" /></button></div>)}</div>}

        <div className={`glass-strong rounded-2xl px-2.5 py-2 flex items-end gap-2 transition-all ${isBusy ? 'opacity-90' : 'focus-within:neon-border-cyan'}`}>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading || isBusy} className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-cyan-300 hover:bg-cyan-400/10 disabled:opacity-40 transition" aria-label="Attach anything" title="Attach files for CEO analysis">
            {uploading ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Paperclip className="w-4 h-4" /></motion.div> : <Paperclip className="w-4 h-4" />}
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" accept="image/*,.txt,.md,.csv,.json,.js,.ts,.tsx,.jsx,.html,.css,.xml,.yaml,.yml,.log,.py,.go,.rs,.java,.c,.cpp,.h,.pdf,.sh,.sql" onChange={handleFile} />
          <textarea ref={textareaRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} placeholder="Ask CEO_AGENT007 anything…" rows={1} className="flex-1 bg-transparent resize-none outline-none text-sm text-[#e0e7ff] placeholder:text-[#5b6a92] py-2 max-h-[200px] overflow-y-auto scroll-cyan" />
          <button onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')} className="flex-shrink-0 h-9 px-2.5 rounded-lg text-[11px] font-semibold tracking-wider glass border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 transition flex items-center gap-1.5" title="Toggle CEO reply language" aria-label="Toggle language"><span className={language === 'en' ? 'text-cyan-300' : 'text-[#7c89b5]'}>EN</span><span className="text-[#5b6a92]">|</span><span className={language === 'zh' ? 'text-purple-300' : 'text-[#7c89b5]'}>ES</span></button>
          <button onClick={toggleVoice} disabled={isBusy} className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition ${listening ? 'bg-cyan-400/20 border border-cyan-400/60 text-cyan-200' : 'text-cyan-300 hover:bg-cyan-400/10'} disabled:opacity-40`} aria-label="Voice input" title="Voice input"><Mic className="w-4 h-4" /></button>
          {isBusy ? <button onClick={stopStreaming} className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-pink-500/20 border border-pink-400/50 text-pink-200 hover:bg-pink-500/30 transition" aria-label="Stop generation" title="Stop"><Square className="w-3.5 h-3.5" fill="currentColor" /></button> : <button onClick={handleSend} disabled={!text.trim() && attachments.length === 0} className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center neon-btn-cyan disabled:cursor-not-allowed" aria-label="Send message" title="Send (Enter)"><ArrowUp className="w-4 h-4" strokeWidth={2.5} /></button>}
        </div>
        <div className="mt-1.5 text-center text-[10px] text-[#5b6a92] tracking-wide">Enter to send • Shift+Enter for new line • Attach files or use voice</div>
      </div>
    </div>
  )
}
