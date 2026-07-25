/**
 * /success — UPGRADE #127 + #150
 * Customer sees this page after successful Stripe payment.
 *
 * Verifies the checkout session with Stripe's API to confirm
 * the payment was real (not just a URL visit).
 *
 * UPGRADE #150: Also fetches the download link from the webhook's fulfillment
 * (stored in the UserSetting table, keyed by transaction ID). If the webhook
 * hasn't fired yet (race condition — webhook can take 1-5s), polls up to 3x.
 */
'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, Loader2, Download, Mail, Clock } from 'lucide-react'
import { motion } from 'framer-motion'

function SuccessContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session_id')
  const productId = searchParams.get('product')
  const [verifying, setVerifying] = useState(true)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')
  const [sessionData, setSessionData] = useState<any>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [downloadExpiresAt, setDownloadExpiresAt] = useState<string | null>(null)
  const [pollCount, setPollCount] = useState(0)

  useEffect(() => {
    async function verifySession() {
      if (!sessionId) {
        setError('No session ID found in URL')
        setVerifying(false)
        return
      }
      try {
        // Verify the session with our backend (which calls Stripe API)
        const res = await fetch(`/api/checkout/verify?session_id=${sessionId}`)
        const data = await res.json()
        if (data.ok && data.paymentStatus === 'paid') {
          setVerified(true)
          setSessionData(data.session)

          // UPGRADE #150: Fetch the download link.
          // The webhook may not have fired yet (1-5s delay), so we poll up to 3x.
          await fetchDownloadLink(sessionId, 0)
        } else {
          setError(data.error || 'Payment verification failed')
        }
      } catch (e: any) {
        setError(e?.message || 'Verification error')
      } finally {
        setVerifying(false)
      }
    }

    async function fetchDownloadLink(txId: string, attempt: number) {
      try {
        const res = await fetch(`/api/download-link?session_id=${txId}`)
        const data = await res.json()
        if (data.ok && data.url) {
          setDownloadUrl(data.url)
          setDownloadExpiresAt(data.expiresAt)
          return
        }
        // Webhook hasn't fired yet — poll up to 3 times with 2s delay
        if (attempt < 3) {
          setPollCount(attempt + 1)
          setTimeout(() => fetchDownloadLink(txId, attempt + 1), 2000)
        }
      } catch {
        // Non-fatal — the email will still have the link
        if (attempt < 3) {
          setPollCount(attempt + 1)
          setTimeout(() => fetchDownloadLink(txId, attempt + 1), 2000)
        }
      }
    }

    verifySession()
  }, [sessionId])

  return (
    <div className="min-h-screen bg-[#050810] text-white flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-lg w-full"
      >
        {verifying ? (
          <div className="text-center">
            <Loader2 className="w-12 h-12 animate-spin text-cyan-400 mx-auto mb-4" />
            <h1 className="text-xl font-bold">Verifying your payment...</h1>
            <p className="text-sm text-gray-500 mt-2">Confirming with Stripe</p>
          </div>
        ) : verified ? (
          <div className="bg-white/[0.03] border border-emerald-400/30 rounded-2xl p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-emerald-300 mb-2">Payment Successful!</h1>
            <p className="text-sm text-gray-400 mb-6">
              Thank you for your purchase. Your payment has been verified.
            </p>
            <div className="bg-black/30 rounded-lg p-4 text-left text-xs space-y-2 mb-6">
              <div className="flex justify-between">
                <span className="text-gray-500">Product</span>
                <span className="text-white">{sessionData?.metadata?.productName || productId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Amount</span>
                <span className="text-white">${(sessionData?.amount_total / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Transaction ID</span>
                <span className="text-cyan-300 font-mono">{sessionId?.slice(0, 20)}...</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <span className="text-emerald-400 font-bold">✓ VERIFIED</span>
              </div>
            </div>

            {/* UPGRADE #150: Download link section */}
            {downloadUrl ? (
              <div className="bg-cyan-500/10 border border-cyan-400/40 rounded-xl p-5 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Download className="w-5 h-5 text-cyan-300" />
                  <span className="text-sm font-semibold text-cyan-200">Your download is ready</span>
                </div>
                <a
                  href={downloadUrl}
                  className="block w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-3 rounded-lg transition text-center"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download Now
                </a>
                {downloadExpiresAt && (
                  <p className="text-[10px] text-gray-500 mt-2 flex items-center justify-center gap-1">
                    <Clock className="w-3 h-3" />
                    Link expires {new Date(downloadExpiresAt).toLocaleDateString()} (7 days)
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-5 mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                  <span className="text-sm font-semibold text-amber-200">
                    Preparing your download link... {pollCount > 0 && `(attempt ${pollCount}/3)`}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  We are also emailing the download link to {sessionData?.customer_email || 'your email'}.
                  If this section does not load in 10 seconds, check your email (including spam folder).
                </p>
              </div>
            )}

            {/* Email reminder */}
            <div className="bg-white/[0.02] border border-white/10 rounded-lg p-3 mb-4 text-xs text-gray-400 flex items-start gap-2">
              <Mail className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
              <span>
                We have also emailed your download link to <span className="text-white">{sessionData?.customer_email || 'your email'}</span>.
                If you do not see it within 5 minutes, check your spam folder.
              </span>
            </div>

            <a
              href="/buy/50-ai-tools-guide"
              className="inline-block text-sm text-cyan-400 hover:underline"
            >
              ← Back to store
            </a>
          </div>
        ) : (
          <div className="bg-white/[0.03] border border-red-400/30 rounded-2xl p-8 text-center">
            <h1 className="text-2xl font-bold text-red-300 mb-2">Verification Failed</h1>
            <p className="text-sm text-gray-400 mb-4">{error}</p>
            <a href="/buy/50-ai-tools-guide" className="inline-block text-sm text-cyan-400 hover:underline">
              ← Back to store
            </a>
          </div>
        )}
      </motion.div>
    </div>
  )
}

export default function SuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#050810] flex items-center justify-center">
        <Loader2 className="w-12 h-12 animate-spin text-cyan-400" />
      </div>
    }>
      <SuccessContent />
    </Suspense>
  )
}

