import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SessionProvider } from "@/components/providers/session-provider";
import { ServiceWorkerRegister } from "@/components/providers/service-worker-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent007 AI — Super Agent Console",
  description:
    "Agent007 AI — autonomous income-operator super-agent. 12+ sub-agents, voice I/O, multi-user, Stripe/PayPal income tracking, RAG knowledge base. Build, execute, monitor, present outcomes.",
  keywords: [
    "Agent007 AI",
    "AI agent",
    "super agent",
    "passive income",
    "income operator",
    "multi-agent",
    "tool use",
    "reasoning trace",
    "$20K/month with 20% monthly growth",
    "PWA",
    "voice AI",
    "RAG",
    "Stripe",
    "PayPal",
  ],
  authors: [{ name: "Agent007 AI" }],
  applicationName: "Agent007 AI",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Agent007 AI",
    statusBarStyle: "black-translucent",
  },
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
    title: "Agent007 AI — Super Agent Console",
    description: "Autonomous income-operator super-agent with 12+ sub-agents, voice I/O, multi-user, and RAG.",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground agent007-root`}
        suppressHydrationWarning
      >
        <SessionProvider>{children}</SessionProvider>
        <Toaster />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
