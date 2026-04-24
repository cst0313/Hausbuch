// path: src/app/layout.tsx
import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono, Inter_Tight } from "next/font/google";
import "./globals.css";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { LocaleProvider } from "@/components/LocaleProvider";

const sans = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const display = Inter_Tight({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600"],
});

const serif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Hausbuch — one document per building",
  description:
    "Hausbuch turns scattered emails, PDFs, ERP rows and Slack into one living, self-updating, citation-backed Context.md per property. 90% of property managers react. Hausbuch remembers.",
  openGraph: {
    title: "Hausbuch — one document per building",
    description:
      "Plain English. No legalese. The document every building should already have.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} ${serif.variable} ${mono.variable} antialiased`}
    >
      <body className="min-h-screen">
        <LocaleProvider>
          <KeyboardShortcuts />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
