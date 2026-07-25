/**
 * /buy/[productId] — UPGRADE #127 (Recommendation 1)
 * Customer-facing product page with a "Buy Now" button.
 *
 * This is the FIRST customer-facing page in the system.
 * No auth required — anyone on the internet can visit this page.
 *
 * Flow:
 *   1. Customer visits /buy/50-ai-tools-guide
 *   2. Page fetches product details from /api/checkout (GET)
 *   3. Customer clicks "Buy Now"
 *   4. POST /api/checkout creates a Stripe Checkout Session
 *   5. Customer is redirected to Stripe's hosted checkout page
 *   6. Customer pays with card
 *   7. Stripe sends webhook to /api/webhooks/stripe
 *   8. Webhook verifies signature → creates IncomeEntry with real transaction ID
 *   9. Customer is redirected to /success?session_id=...
 */
'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Check, Loader2, ShoppingBag, Shield, Zap } from 'lucide-react'

interface Product {
  id: string
  name: string
  description: string
  price: string
  priceCents: number
  available?: boolean  // UPGRADE #150: from CHECKOUT_ALLOW_LIST
}

export default function BuyPage() {
  const params = useParams()
  const productId = params.productId as string
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [redirecting, setRedirecting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadProduct() {
      try {
        const res = await fetch('/api/checkout')
        const data = await res.json()
        if (data.ok) {
          const found = data.products.find((p: Product) => p.id === productId)
          if (found) {
            setProduct(found)
          } else {
            setError(`Product "${productId}" not found. Available: ${data.products.map((p: Product) => p.id).join(', ')}`)
          }
        } else {
          setError(data.error || 'Failed to load products')
        }
      } catch (e: any) {
        setError(e?.message || 'Network error')
      } finally {
        setLoading(false)
      }
    }
    loadProduct()
  }, [productId])

  const handleBuy = async () => {
    if (!product) return
    setRedirecting(true)
    setError('')
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id }),
      })
      const data = await res.json()
      if (data.ok && data.url) {
        window.location.href = data.url
      } else {
        setError(data.error || 'Failed to create checkout session')
        setRedirecting(false)
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
      setRedirecting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    )
  }

  if (error && !product) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-4">Product Not Found</h1>
          <p className="text-sm text-gray-400">{error}</p>
          <a href="/buy/50-ai-tools-guide" className="inline-block mt-4 text-cyan-400 hover:underline">
            ← Browse available products
          </a>
        </div>
      </div>
    )
  }

  if (!product) return null

  return (
    <div className="min-h-screen bg-[#050810] text-white">
      {/* Header */}
      <header className="border-b border-cyan-400/10 p-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-cyan-400" />
            <span className="font-bold text-cyan-300">Agent007 Store</span>
          </div>
          <span className="text-xs text-gray-500">Secure Checkout</span>
        </div>
      </header>

      {/* Product */}
      <main className="max-w-3xl mx-auto px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/[0.03] border border-cyan-400/20 rounded-2xl p-8"
        >
          <div className="mb-6">
            <span className="inline-block text-[10px] font-bold tracking-wider uppercase text-cyan-400 bg-cyan-400/10 px-2 py-1 rounded-full mb-3">
              Digital Product
            </span>
            <h1 className="text-3xl font-bold mb-3">{product.name}</h1>
            <p className="text-gray-400 leading-relaxed">{product.description}</p>
          </div>

          <div className="flex items-center gap-6 mb-8 pb-8 border-b border-white/5">
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Price</div>
              <div className="text-4xl font-bold text-cyan-300">{product.price}</div>
            </div>
            <div className="flex-1" />
            <div className="flex flex-col gap-2 text-xs text-gray-400">
              <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-emerald-400" /> Stripe Secure Payment</span>
              <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" /> Instant Digital Delivery</span>
              <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-cyan-400" /> 30-Day Money Back Guarantee</span>
            </div>
          </div>

          {/* UPGRADE #150: Show Buy Now (available products) or Coming Soon (blocked products) */}
          {product.available ? (
            <>
              {/* Launch pricing banner */}
              <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200">
                🎉 <strong>Launch special:</strong> First 50 customers get 30% off (automatically applied at checkout). Price returns to $27 after 50 sales.
              </div>

              <button
                onClick={handleBuy}
                disabled={redirecting}
                className="w-full py-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black font-bold text-lg transition flex items-center justify-center gap-2"
              >
                {redirecting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Redirecting to Stripe...
                  </>
                ) : (
                  <>
                    <ShoppingBag className="w-5 h-5" />
                    Buy Now — {product.price}
                  </>
                )}
              </button>

              <p className="text-center text-xs text-gray-500 mt-4">
                Instant download after payment. 30-day money-back guarantee.
              </p>
            </>
          ) : (
            <>
              <div className="mb-4 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
                <strong>🚧 Coming Soon</strong> — This product is being finalized and is not yet available for purchase.
                <br /><br />
                <a href={`mailto:antonio.can2022@hotmail.com?subject=Notify me when ${product.name} is ready`} className="text-cyan-300 hover:underline">
                  Click here to be notified when it launches →
                </a>
              </div>

              <button
                disabled={true}
                className="w-full py-4 rounded-xl bg-gray-600/30 text-gray-500 font-bold text-lg cursor-not-allowed flex items-center justify-center gap-2"
              >
                <ShoppingBag className="w-5 h-5" />
                Coming Soon — Not Yet Available
              </button>

              <p className="text-center text-xs text-gray-500 mt-4">
                This product is being prepared. Check back soon or contact us to be notified.
              </p>
            </>
          )}
        </motion.div>
      </main>
    </div>
  )
}
