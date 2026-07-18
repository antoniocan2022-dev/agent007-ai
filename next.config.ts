import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: [
    "@whiskeysockets/baileys",
    "sharp",
    "jimp",
    "qrcode",
    "canvas",
    "better-sqlite3",
    "uuid",
  ],
  turbopack: {
    resolveAlias: {
      // Allow native modules to be externalized
    },
  },
  // UPGRADE #70 — Cache-busting headers for multi-device sync
  // UPGRADE #96 — Added security headers (X-Frame-Options, X-Content-Type-Options, CSP, Referrer-Policy)
  // Ensures all devices always fetch the latest version from Vercel.
  // No stale cached HTML — every device sees the SAME version.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Cache-busting (UPGRADE #70)
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
          // Security headers (UPGRADE #96)
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // CSP — permissive enough to not break images/fonts/scripts from external APIs
          // but strict enough to prevent XSS and data exfiltration
          { key: 'Content-Security-Policy', value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com data:",
            "img-src 'self' data: https: blob:",
            "connect-src 'self' https://api.openai.com https://api.groq.com https://generativelanguage.googleapis.com https://api.cloudflare.com https://api.together.xyz https://api.mistral.ai https://api-inference.huggingface.co https://api.cohere.ai https://api.cerebras.ai https://api.sambanova.ai https://api.tavily.com https://api.exa.ai https://api.producthunt.com https://api.remove.bg https://api.stability.ai https://api.elevenlabs.io https://api-free.deepl.com https://api.serpdog.io https://newsapi.org https://www.alphavantage.co https://api.stlouisfed.org https://r.jina.ai https://api.search.brave.com https://api.serpapi.com https://api.etsy.com https://api.convertkit.com https://api.buffer.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join('; ') },
        ],
      },
      // Static assets (JS, CSS, images) CAN be cached — they have content-hash in the URL
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ]
  },
};

export default nextConfig;
