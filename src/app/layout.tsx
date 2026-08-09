import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SessionProvider } from "@/components/providers/session-provider";
import { ServiceWorkerRegister } from "@/components/providers/service-worker-register";
import { PreWarmDb } from "@/components/providers/pre-warm-db";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CEO_AGENT007 — Executive Operating System",
  description: "CEO_AGENT007 is the executive operating system for planning, executing, managing and measuring an autonomous business organization.",
  keywords: ["CEO_AGENT007", "Agent007 AI", "executive operating system", "autonomous business", "multi-agent", "missions", "venture management", "finance", "automation"],
  authors: [{ name: "Agent007 AI" }],
  applicationName: "CEO_AGENT007",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "CEO_AGENT007", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    shortcut: ["/favicon-32.png"],
  },
  openGraph: {
    title: "CEO_AGENT007 — Executive Operating System",
    description: "An executive AI workspace for missions, businesses, finance, organization and automation.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#00f0ff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground agent007-root`} suppressHydrationWarning>
        <PreWarmDb />
        <SessionProvider>{children}</SessionProvider>
        <Toaster />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
