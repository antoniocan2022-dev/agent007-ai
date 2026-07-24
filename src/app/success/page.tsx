/**
 * /success — UPGRADE #127 (Recommendation 1)
 * Customer sees this page after successful Stripe payment.
 *
 * Verifies the checkout session with Stripe's API to confirm
 * the payment was real (not just a URL visit).
 */
'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, Loader2, Download } from 'lucide-react'
import { motion } from 'framer-motion'

function SuccessContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session_id')
  const productId = searchParams.get('product')
  const [verifying, setVerifying] = useState(true)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')
  const [sessionData, setSessionData] = useState<any>(null)

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
        } else {
          setError(data.error || 'Payment verification failed')
        }
      } catch (e: any) {
        setError(e?.message || 'Verification error')
      } finally {
        setVerifying(false)
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
