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
  ],
  turbopack: {
    resolveAlias: {
      // Allow native modules to be externalized
    },
  },
};

export default nextConfig;
