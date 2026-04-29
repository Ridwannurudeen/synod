import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Synod — Decentralized AI Settlement for Delphi",
  description:
    "Heterogeneous AI settlers reach quorum-signed consensus over Gensyn AXL and post the result on-chain to SynodRegistry.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
