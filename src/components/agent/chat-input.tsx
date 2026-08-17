'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { ArrowUp, FileText, Link2, Mic, Paperclip, Square, X } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import { MAX_ATTACHMENT_BYTES, MULTIPART_PART_BYTES } from '@/lib/attachment-policy'
import type { AttachmentMeta } from '@/lib/tools'

interface UploadView {
  id: string
  name: string
  size: number
  uploaded: number
  status: 'uploading' | 'complete' | 'error'
  error?: string
}

type ExtendedAttachmentMeta = AttachmentMeta & { attachmentId: string; status: string; kind: string; downloadOnly?: boolean }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = -1
  do { value /= 1024; index++ } while (value >= 1024 && index < units.length - 1)
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`
}

function uploadPart(file: File, start: number, end: number, url: string, onProgress: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded) }
    xhr.onerror = () => reject(new Error('Network error while uploading attachment part.'))
    xhr.onabort = () => reject(new Error('Attachment upload was cancelled.'))
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Storage returned HTTP ${xhr.status} for the upload part.`))
        return
      }
      const etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag')
      if (!etag) reject(new Error('Storage did not expose the required ETag header. Check bucket CORS ExposeHeaders.'))
      else resolve(etag)
    }
    xhr.send(file.slice(start, end))
  })
}

export function ChatInput() {
  const [text, setText] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [uploadViews, setUploadViews] = useState<Record<string, UploadView>>({})
  const [listening, setListening] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)
  const language = useChatStore((s) => s.language)
  const attachments = useChatStore((s) => s.attachments)
  const addAttachment = useChatStore((s) => s.addAttachment)
  const removeAttachment = useChatStore((s) => s.removeAttachment)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const stopStreaming = useChatStore((s) => s.stopStreaming)
  const status = useChatStore((s) => s.status)
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const isBusy = status !== 'idle'

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [text])

  useEffect(() => () => recognitionRef.current?.stop?.(), [])

  const patchUpload = (id: string, patch: Partial<UploadView>) => setUploadViews((current) => ({ ...current, [id]: { ...current[id], ...patch } }))

  const uploadOne = useCallback(async (file: File) => {
    if (file.size <= 0) throw new Error('Empty files cannot be attached.')
    if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`“${file.name}” exceeds the 10 GiB per-file limit.`)

    const clientRequestId = crypto.randomUUID()
    const view: UploadView = { id: clientRequestId, name: file.name, size: file.size, uploaded: 0, status: 'uploading' }
    setUploadViews((current) => ({ ...current, [clientRequestId]: view }))

    try {
      const initiated = await fetch('/api/attachments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, conversationId: currentConversationId, clientRequestId }),
      })
      const initBody = await initiated.json().catch(() => ({}))
      if (!initiated.ok || !initBody.asset) throw new Error(initBody.error || 'Attachment storage initialization failed.')
      const asset = initBody.asset

      const statusRes = await fetch(`/api/attachments/${asset.id}`, { cache: 'no-store' })
      const statusBody = await statusRes.json().catch(() => ({}))
      if (!statusRes.ok || !statusBody.asset) throw new Error(statusBody.error || 'Unable to inspect attachment upload state.')
      const existingParts: Array<{ partNumber: number; etag: string; size?: number }> = Array.isArray(statusBody.parts) ? statusBody.parts : []
      const uploadedByPart = new Map(existingParts.map((part) => [part.partNumber, part]))
      const partSize = Number(asset.partSize) || MULTIPART_PART_BYTES
      const partCount = Number(asset.partCount)
      if (!Number.isInteger(partCount) || partCount < 1) throw new Error('Storage returned an invalid multipart part count.')

      let completedBytes = existingParts.reduce((sum, part) => sum + Number(part.size || Math.min(partSize, file.size - (part.partNumber - 1) * partSize)), 0)
      patchUpload(clientRequestId, { uploaded: Math.min(file.size, completedBytes) })

      const rangeRes = await fetch(`/api/attachments/${asset.id}/parts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startPart: 1, endPart: partCount }),
      })
      const rangeBody = await rangeRes.json().catch(() => ({}))
      if (!rangeRes.ok || !Array.isArray(rangeBody.parts)) throw new Error(rangeBody.error || 'Unable to obtain secure upload URLs.')
      const urls = new Map<number, string>(rangeBody.parts.map((part: { partNumber: number; url: string }) => [part.partNumber, part.url]))
      const pending = Array.from({ length: partCount }, (_, index) => index + 1).filter((partNumber) => !uploadedByPart.has(partNumber))
      const activeProgress = new Map<number, number>()
      let cursor = 0

      const worker = async () => {
        while (true) {
          const index = cursor++
          if (index >= pending.length) return
          const partNumber = pending[index]
          const start = (partNumber - 1) * partSize
          const end = Math.min(file.size, start + partSize)
          const url = urls.get(partNumber)
          if (!url) throw new Error(`Missing signed URL for upload part ${partNumber}.`)
          const etag = await uploadPart(file, start, end, url, (loaded) => {
            activeProgress.set(partNumber, loaded)
            const liveBytes = Array.from(activeProgress.values()).reduce((sum, value) => sum + value, 0)
            patchUpload(clientRequestId, { uploaded: Math.min(file.size, completedBytes + liveBytes) })
          })
          uploadedByPart.set(partNumber, { partNumber, etag, size: end - start })
          completedBytes += end - start
          activeProgress.delete(partNumber)
          patchUpload(clientRequestId, { uploaded: Math.min(file.size, completedBytes) })
        }
      }

      await Promise.all([worker(), worker(), worker()])
      const parts = Array.from(uploadedByPart.values()).sort((a, b) => a.partNumber - b.partNumber)
      const complete = await fetch(`/api/attachments/${asset.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts }),
      })
      const completeBody = await complete.json().catch(() => ({}))
      if (!complete.ok || !completeBody.attachment) throw new Error(completeBody.error || 'Attachment completion failed.')

      const smallTextContent = file.size <= 1024 * 1024 && (file.type.startsWith('text/') || /json|xml|csv|yaml|javascript|typescript/.test(file.type))
        ? (await file.slice(0, 8000).text()).slice(0, 8000)
        : undefined
      const metadata: ExtendedAttachmentMeta = {
        attachmentId: completeBody.attachment.attachmentId,
        filename: completeBody.attachment.filename,
        originalName: completeBody.attachment.originalName,
        mimeType: completeBody.attachment.mimeType,
        size: Number(completeBody.attachment.size),
        status: completeBody.attachment.status,
        kind: completeBody.attachment.kind,
        downloadOnly: completeBody.attachment.downloadOnly,
        textContent: smallTextContent,
      }
      addAttachment(metadata as unknown as AttachmentMeta)
      patchUpload(clientRequestId, { uploaded: file.size, status: 'complete' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Attachment upload failed.'
      patchUpload(clientRequestId, { status: 'error', error: message })
      throw error
    }
  }, [addAttachment, currentConversationId])

  const handleFiles = async (files: FileList | File[]) => {
    const selected = Array.from(files)
    if (!selected.length || uploading || isBusy) return
    setUploading(true)
    try {
      for (const file of selected) {
        try { await uploadOne(file) } catch (error) { console.error('[attachments]', error) }
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleSend = useCallback(() => {
    const t = text.trim()
    if (!t && attachments.length === 0) return
    if (isBusy || uploading) return
    setText('')
    sendMessage(t)
  }, [text, attachments, isBusy, uploading, sendMessage])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const toggleVoice = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) { alert('Voice input is not supported by this browser.'); return }
    if (listening) { recognitionRef.current?.stop?.(); setListening(false); return }
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

  return (
    <div className="px-3 sm:px-4 pb-3 pt-2">
      <div className="max-w-[820px] mx-auto">
        {Object.values(uploadViews).filter((item) => item.status !== 'complete').map((item) => (
          <div key={item.id} className="mb-2 rounded-lg border border-cyan-400/15 bg-cyan-400/5 px-3 py-2 text-[10px] text-[#9bb5d4]">
            <div className="flex items-center justify-between gap-2"><span className="truncate">{item.name}</span><span>{Math.round((item.uploaded / item.size) * 100)}%</span></div>
            <div className="mt-1 h-1 rounded-full bg-white/5 overflow-hidden"><div className="h-full bg-gradient-to-r from-cyan-400 to-purple-500" style={{ width: `${Math.min(100, Math.max(0, (item.uploaded / item.size) * 100))}%` }} /></div>
            {item.error && <div className="mt-1 text-pink-300 break-words">{item.error}</div>}
          </div>
        ))}

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-1">
            {attachments.map((a) => {
              const extended = a as AttachmentMeta & { attachmentId?: string; status?: string }
              return <div key={a.filename} className="relative group flex items-center gap-2 px-2 py-1 rounded-md glass text-xs text-[#9bb5d4] max-w-[280px]">
                {extended.status === 'UPLOADED' ? <Link2 className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" /> : <FileText className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" />}
                <span className="truncate max-w-[180px]">{a.originalName}</span>
                <span className="text-[9px] text-[#5b6a92]">{formatBytes(a.size)}</span>
                <button onClick={() => removeAttachment(a.filename)} className="text-[#7c89b5] hover:text-pink-300" aria-label={`Remove ${a.originalName}`}><X className="w-3 h-3" /></button>
              </div>
            })}
          </div>
        )}

        <div
          onDragEnter={(event) => { event.preventDefault(); if (!isBusy) setDragActive(true) }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDragActive(false) }}
          onDrop={(event) => { event.preventDefault(); setDragActive(false); void handleFiles(event.dataTransfer.files) }}
          className={`glass-strong rounded-2xl px-2.5 py-2 flex items-end gap-2 transition-all ${dragActive ? 'neon-border-cyan bg-cyan-400/5' : ''} ${isBusy ? 'opacity-90' : 'focus-within:neon-border-cyan'}`}
        >
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading || isBusy} className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-cyan-300 hover:bg-cyan-400/10 disabled:opacity-40 transition" aria-label="Attach files" title="Attach any file type, up to 10 GiB per file">
            <Paperclip className="w-4 h-4" />
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" accept="*/*" onChange={(event) => { if (event.target.files) void handleFiles(event.target.files) }} />
          <textarea ref={textareaRef} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} placeholder="Ask CEO_AGENT007 anything…" rows={1} className="flex-1 bg-transparent resize-none outline-none text-sm text-[#e0e7ff] placeholder:text-[#5b6a92] py-2 max-h-[200px] overflow-y-auto scroll-cyan" />
          <button onClick={toggleVoice} disabled={isBusy} className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition ${listening ? 'bg-cyan-400/20 border border-cyan-400/60 text-cyan-200' : 'text-cyan-300 hover:bg-cyan-400/10'} disabled:opacity-40`} aria-label="Voice input" title="Voice input"><Mic className="w-4 h-4" /></button>
          {isBusy ? <button onClick={stopStreaming} className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-pink-500/20 border border-pink-400/50 text-pink-200 hover:bg-pink-500/30 transition" aria-label="Stop generation" title="Stop"><Square className="w-3.5 h-3.5" fill="currentColor" /></button> : <button onClick={handleSend} disabled={!text.trim() && attachments.length === 0 || uploading} className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center neon-btn-cyan disabled:cursor-not-allowed" aria-label="Send message" title="Send (Enter)"><ArrowUp className="w-4 h-4" strokeWidth={2.5} /></button>}
        </div>
        <div className="mt-1.5 flex items-center justify-center gap-2 text-[10px] text-[#5b6a92] tracking-wide">
          <span>Enter to send • Shift+Enter for new line</span>
          <span>•</span>
          <span>Images • Audio • Video • Documents • Any file</span>
          <span>•</span>
          <span>10 GiB max/file</span>
        </div>
      </div>
    </div>
  )
}
