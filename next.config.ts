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
  // Ensures all devices always fetch the latest version from Vercel.
  // No stale cached HTML — every device sees the SAME version.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
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
