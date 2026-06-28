import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NEXUS AI — Super Agent Console",
  description:
    "NEXUS AI — an autonomous super-agent console. Web search, image generation, vision, code execution, file handling, and persistent memory. Built to learn. Built to earn.",
  keywords: [
    "NEXUS AI",
    "AI agent",
    "super agent",
    "Devin",
    "Cursor",
    "tool use",
    "reasoning trace",
    "income generation",
  ],
  authors: [{ name: "NEXUS AI" }],
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground nexus-root`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
