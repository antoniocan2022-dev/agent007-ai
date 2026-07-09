'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, X, Smartphone, MessageCircle, Mail, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

interface SendCommandModalProps {
  open: boolean
  onClose: () => void
}

export function SendCommandModal({ open, onClose }: SendCommandModalProps) {
  const [channel, setChannel] = useState<'sms' | 'whatsapp' | 'email'>('sms')
  const [to, setTo] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const handleSend = async () => {
    if (!to.trim() || !message.trim() || sending) return
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/commands/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), channel, message: message.trim() }),
      })
      const data = await res.json()
      setResult({ ok: data.ok, message: data.message || data.error || 'Unknown result' })
      if (data.ok) {
        setMessage('')
      }
    } catch (e: any) {
      setResult({ ok: false, message: e?.message ?? 'Send failed' })
    } finally {
      setSending(false)
    }
  }

  const CHANNEL_ICONS = {
    sms: Smartphone,
    whatsapp: MessageCircle,
    email: Mail,
  }

  const CHANNEL_COLORS = {
    sms: '#00f0ff',
    whatsapp: '#25d366',
    email: '#a855f7',
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => !sending && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 18 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg glass-strong sm:rounded-2xl p-5 sm:p-6 min-h-screen sm:min-h-0 overflow-y-auto scroll-cyan"
            style={{ borderColor: 'rgba(0,240,255,0.35)', boxShadow: '0 0 40px rgba(0,240,255,0.15)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Send className="w-5 h-5 text-cyan-300" />
                <h2 className="text-base font-bold text-[#e0e7ff]">Send Command</h2>
              </div>
              <button
                onClick={() => !sending && onClose()}
                className="sm:hidden text-[#7c89b5] hover:text-cyan-300 p-1"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-[11px] text-[#7c89b5] mb-4">
              Send a message directly from your dashboard to any phone (SMS), WhatsApp number, or email address.
            </p>

            {/* Channel selector */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {(['sms', 'whatsapp', 'email'] as const).map((ch) => {
                const Icon = CHANNEL_ICONS[ch]
                const isActive = channel === ch
                const color = CHANNEL_COLORS[ch]
                return (
                  <button
                    key={ch}
                    onClick={() => setChannel(ch)}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-lg border transition ${
                      isActive ? 'border-2' : 'border border-transparent glass'
                    }`}
                    style={
                      isActive
                        ? { borderColor: color, background: `${color}15`, boxShadow: `0 0 12px ${color}30` }
                        : {}
                    }
                  >
                    <Icon className="w-5 h-5" style={{ color: isActive ? color : '#7c89b5' }} />
                    <span
                      className="text-[10px] font-semibold tracking-wider uppercase"
                      style={{ color: isActive ? color : '#7c89b5' }}
                    >
                      {ch === 'sms' ? 'SMS' : ch === 'whatsapp' ? 'WhatsApp' : 'Email'}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Recipient field */}
            <div className="mb-3">
              <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1.5 font-semibold">
                {channel === 'email' ? 'TO EMAIL' : 'TO PHONE NUMBER'}
              </label>
              <input
                type={channel === 'email' ? 'email' : 'tel'}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder={
                  channel === 'email'
                    ? 'recipient@example.com'
                    : '+14165551234'
                }
                className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] placeholder:text-[#5b6a92] outline-none focus:border-cyan-400/70 transition"
              />
            </div>

            {/* Message field */}
            <div className="mb-3">
              <label className="block text-[10px] tracking-[0.2em] text-[#7c89b5] mb-1.5 font-semibold">
                MESSAGE
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                maxLength={1600}
                placeholder="Type your message here..."
                className="w-full glass rounded-lg px-3 py-2.5 text-sm text-[#e0e7ff] placeholder:text-[#5b6a92] outline-none focus:border-cyan-400/70 transition resize-none"
              />
              <div className="text-right text-[9px] text-[#5b6a92] mt-0.5">
                {message.length} / 1600
              </div>
            </div>

            {/* Result message */}
            {result && (
              <div
                className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs mb-3 ${
                  result.ok
                    ? 'bg-emerald-500/10 border border-emerald-400/40 text-emerald-200'
                    : 'bg-amber-500/10 border border-amber-400/40 text-amber-200'
                }`}
              >
                {result.ok ? (
                  <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                )}
                <span className="leading-snug">{result.message}</span>
              </div>
            )}

            {/* Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => !sending && onClose()}
                className="flex-1 px-4 py-2.5 rounded-lg text-xs font-semibold glass border-cyan-400/20 text-[#cfd9f0] hover:border-cyan-400/40 transition"
                style={{ touchAction: 'manipulation' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={!to.trim() || !message.trim() || sending}
                className="flex-1 neon-btn-cyan rounded-lg py-2.5 text-xs font-bold tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ touchAction: 'manipulation' }}
              >
                {sending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    SENDING…
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    SEND
                  </>
                )}
              </button>
            </div>

            {/* Info note */}
            <div className="mt-4 text-[10px] text-[#5b6a92] leading-relaxed">
              💡 <strong>Note:</strong> To actually send SMS/WhatsApp messages, configure Twilio or WhatsApp
              Business API credentials in Settings → COMMAND CHANNELS. Without credentials, messages are
              logged but not sent. Email sending requires SMTP configuration.
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
