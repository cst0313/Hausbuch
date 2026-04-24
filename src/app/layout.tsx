// path: src/app/layout.tsx
import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono, Inter } from "next/font/google";
import "./globals.css";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";

const serif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Lumen — your agents shouldn't have to ask twice",
  description:
    "Lumen is a context engine. It ingests scattered business data and maintains a self-updating, bitemporal, citation-backed Context.md for every entity in your company — so every AI agent reads the same truth.",
  openGraph: {
    title: "Lumen — the context engine",
    description:
      "Company memory, not amnesia management. A self-updating Context.md for every entity in your business.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${serif.variable} ${mono.variable} ${sans.variable} antialiased`}
    >
      <body className="min-h-screen">
        <KeyboardShortcuts />
        {children}
      </body>
    </html>
  );
}
