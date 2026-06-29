import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SessionProvider } from "@/components/providers/session-provider";

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
    "Agent007 AI — an autonomous income-operator super-agent. 10 sub-agents, full internet access, +10% daily growth mission. Build, execute, monitor, present outcomes.",
  keywords: [
    "Agent007 AI",
    "AI agent",
    "super agent",
    "passive income",
    "income operator",
    "multi-agent",
    "tool use",
    "reasoning trace",
    "+10% daily growth",
  ],
  authors: [{ name: "Agent007 AI" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
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
      >
        <SessionProvider>{children}</SessionProvider>
        <Toaster />
      </body>
    </html>
  );
}
