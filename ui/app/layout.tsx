import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const TITLE = "Synod — AI Receipts";
const DESCRIPTION =
  "Verifiable, transferable, ENS-addressable, 0G-anchored proofs of multi-model AI consensus. Multi-model settler quorum on Gensyn AXL + Gensyn L2 + ENS + 0G Storage.";
const SITE_URL = "https://synod.gudman.xyz";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "AI agents",
    "decentralized AI",
    "ENS",
    "Gensyn AXL",
    "0G Storage",
    "AI oracle",
    "ed25519 consensus",
    "agent identity",
  ],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "Synod",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    site: "@ggudman",
    creator: "@ggudman",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
