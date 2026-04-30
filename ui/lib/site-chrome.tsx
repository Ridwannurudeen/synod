/**
 * Site-wide chrome — used by every top-level route to keep the
 * design language cohesive. Sticky NavBar, consistent SectionHeader,
 * deep footer with stack + source links.
 */

"use client";

import Link from "next/link";

export function NavBar() {
  return (
    <nav className="sticky top-0 z-30 border-b border-ink-800/60 bg-ink-950/72 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-4">
        <Link href="/" className="flex items-baseline gap-2 text-h4 font-semibold tracking-tight text-ink-50">
          <span>synod</span>
          <span className="num text-eyebrow font-normal uppercase tracking-[0.2em] text-ink-500">/0.1</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <NavLink href="/gallery" label="Gallery" />
          <NavLink href="/network" label="Network" />
          <NavLink href="/verify" label="Verify" />
          <a
            href="https://github.com/Ridwannurudeen/synod"
            target="_blank"
            rel="noreferrer"
            className="ml-2 rounded-md border border-ink-800 bg-ink-900/60 px-3 py-1.5 text-caption text-ink-200 transition-colors hover:border-accent-700 hover:text-accent-300"
          >
            GitHub ↗
          </a>
        </div>
      </div>
    </nav>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-caption text-ink-300 transition-colors hover:bg-ink-900 hover:text-ink-100"
    >
      {label}
    </Link>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  sub,
  link,
  linkLabel,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  link?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-ink-800/60 pb-4">
      <div className="flex flex-col gap-1">
        <span className="text-eyebrow uppercase tracking-[0.22em] text-ink-500">{eyebrow}</span>
        <h2 className="text-h2 font-semibold tracking-tight text-ink-50">{title}</h2>
      </div>
      {sub && <p className="max-w-xl text-body-sm text-ink-400">{sub}</p>}
      {link && (
        <Link
          href={link}
          className="ml-auto text-caption text-accent-300 transition-colors hover:text-accent-200"
        >
          {linkLabel ?? "See all →"}
        </Link>
      )}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub: string;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-ink-800/60 pb-8">
      <span className="text-eyebrow uppercase tracking-[0.22em] text-ink-500">{eyebrow}</span>
      <h1 className="text-h1 font-semibold tracking-tight text-ink-50 md:text-display">{title}</h1>
      <p className="max-w-3xl text-body-lg text-ink-300">{sub}</p>
    </header>
  );
}

export function DeepFooter() {
  return (
    <footer className="mt-16 border-t border-ink-800/60 bg-ink-950/40">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 md:grid-cols-4">
        <div className="flex flex-col gap-3">
          <span className="text-h4 font-semibold tracking-tight text-ink-50">synod</span>
          <p className="max-w-xs text-caption text-ink-400">
            AI Receipts. Multi-model AI consensus, signed and addressable.
          </p>
          <span className="num text-micro text-ink-500">v0.1.0 · ETHGlobal Open Agents 2026</span>
        </div>
        <FooterColumn
          title="Protocol"
          links={[
            { label: "Gallery", href: "/gallery" },
            { label: "AXL mesh", href: "/network" },
            { label: "Verify a proof", href: "/verify" },
            { label: "Profile API", href: "/api/agent/settler-a.synodai.eth" },
          ]}
        />
        <FooterColumn
          title="Stack"
          links={[
            { label: "synodai.eth (ENS)", href: "https://app.ens.domains/synodai.eth" },
            { label: "Gensyn L2 explorer", href: "https://gensyn-mainnet.explorer.alchemy.com/address/0xD387f749667590940d7c68CA350e57FbcE62b6ad" },
            { label: "0G Storage scan", href: "https://storagescan-galileo.0g.ai/" },
            { label: "AXL docs", href: "https://docs.gensyn.ai/tech/agent-exchange-layer" },
          ]}
        />
        <FooterColumn
          title="Source"
          links={[
            { label: "GitHub", href: "https://github.com/Ridwannurudeen/synod" },
            { label: "ENSIP draft", href: "https://github.com/Ridwannurudeen/synod/blob/main/docs/ENSIP-DRAFT-AI-AGENT-IDENTITY.md" },
            { label: "Roadmap", href: "https://github.com/Ridwannurudeen/synod/blob/main/docs/ROADMAP.md" },
            { label: "Author · @ggudman", href: "https://x.com/ggudman" },
          ]}
        />
      </div>
      <div className="border-t border-ink-800/60 px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 text-micro text-ink-500">
          <span>SynodRegistry · <code className="num text-ink-400">0xD387f749667590940d7c68CA350e57FbcE62b6ad</code></span>
          <span>chain id <code className="num text-ink-400">685689</code></span>
          <span className="ml-auto">MIT licensed · open infrastructure</span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-eyebrow uppercase tracking-[0.22em] text-ink-500">{title}</span>
      <ul className="flex flex-col gap-1.5 text-caption">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              target={l.href.startsWith("http") ? "_blank" : undefined}
              rel={l.href.startsWith("http") ? "noreferrer" : undefined}
              className="text-ink-300 transition-colors hover:text-accent-300"
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
