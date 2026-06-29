'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Square, Volume2, VolumeX, Loader2 } from 'lucide-react'

interface VoiceControlsProps {
  /** Latest assistant message text to speak */
  latestAssistantText: string
  /** Callback when ASR returns transcribed text (user clicked send) */
  onTranscribed: (text: string) => void
  /** Whether the agent is currently busy (disable mic during processing) */
  disabled?: boolean
}

/**
 * Voice I/O controls — mic button for voice input + speaker button for TTS.
 * Sits next to the chat input bar.
 */
export function VoiceControls({ latestAssistantText, onTranscribed, disabled }: VoiceControlsProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<any>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Auto-speak new assistant messages if TTS enabled
  useEffect(() => {
    if (ttsEnabled && latestAssistantText && latestAssistantText.length > 0) {
      speakText(latestAssistantText)
    }
  }, [latestAssistantText, ttsEnabled, speakText])

  const speakText = useCallback(async (text: string) => {
    if (!text || isSpeaking) return
    setError(null)
    setIsSpeaking(true)
    try {
      // Strip markdown for cleaner speech
      const clean = text
        .replace(/```[\s\S]*?```/g, ' (code block) ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[#*_>`~]/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 1500) // TTS API limit

      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, voice: 'tongtong', speed: 1.0 }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `TTS failed (HTTP ${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      if (audioRef.current) {
        audioRef.current.src = url
        audioRef.current.onended = () => {
          setIsSpeaking(false)
          URL.revokeObjectURL(url)
        }
        audioRef.current.onerror = () => {
          setIsSpeaking(false)
          URL.revokeObjectURL(url)
        }
        await audioRef.current.play().catch(() => setIsSpeaking(false))
      }
    } catch (e: any) {
      setError(e?.message ?? 'TTS failed')
      setIsSpeaking(false)
    }
  }, [isSpeaking])

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setIsSpeaking(false)
  }, [])

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        stream.getTracks().forEach((track) => track.stop())

        // Send to ASR
        setIsTranscribing(true)
        try {
          const formData = new FormData()
          formData.append('audio', audioBlob, 'recording.webm')
          const res = await fetch('/api/voice/asr', {
            method: 'POST',
            body: formData,
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.error || `ASR failed (HTTP ${res.status})`)
          }
          const data = await res.json()
          if (data.text && data.text.trim()) {
            onTranscribed(data.text.trim())
          } else {
            setError('No speech detected. Try again.')
          }
        } catch (e: any) {
          setError(e?.message ?? 'Transcription failed')
        } finally {
          setIsTranscribing(false)
        }
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (e: any) {
      setError(e?.message ?? 'Microphone access denied')
    }
  }, [onTranscribed])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }, [isRecording])

  return (
    <>
      <audio ref={audioRef} className="hidden" />

      <div className="flex items-center gap-1">
        {/* TTS toggle button */}
        <button
          onClick={() => {
            if (isSpeaking) stopSpeaking()
            else if (ttsEnabled) speakText(latestAssistantText)
            setTtsEnabled((v) => !v)
          }}
          disabled={disabled}
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition ${
            ttsEnabled
              ? 'bg-purple-500/20 border border-purple-400/50 text-purple-200'
              : 'text-[#7c89b5] hover:bg-purple-400/10 hover:text-purple-300 border border-transparent'
          } disabled:opacity-40`}
          title={ttsEnabled ? 'Text-to-speech ON — click to disable' : 'Enable text-to-speech'}
          aria-label="Toggle text-to-speech"
          style={{ touchAction: 'manipulation' }}
        >
          {isSpeaking ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : ttsEnabled ? (
            <Volume2 className="w-4 h-4" />
          ) : (
            <VolumeX className="w-4 h-4" />
          )}
        </button>

        {/* Mic button */}
        <button
          onClick={() => {
            if (isRecording) stopRecording()
            else startRecording()
          }}
          disabled={disabled || isTranscribing}
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition ${
            isRecording
              ? 'bg-pink-500/20 border border-pink-400/50 text-pink-200 animate-pulse'
              : 'text-[#7c89b5] hover:bg-cyan-400/10 hover:text-cyan-300 border border-transparent'
          } disabled:opacity-40`}
          title={isRecording ? 'Stop recording' : 'Voice input'}
          aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
          style={{ touchAction: 'manipulation' }}
        >
          {isTranscribing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isRecording ? (
            <Square className="w-3.5 h-3.5" fill="currentColor" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-3 py-2 rounded-lg glass-strong border border-pink-400/40 text-pink-200 text-xs"
            onClick={() => setError(null)}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recording indicator */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full glass-strong border border-pink-400/50 flex items-center gap-2"
          >
            <span className="w-2 h-2 rounded-full bg-pink-400 animate-pulse" />
            <span className="text-xs text-pink-200 font-semibold">Recording… click mic to stop</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
