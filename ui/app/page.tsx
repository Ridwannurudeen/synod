"use client";

/**
 * Synod live deliberation viewer (dashboard archetype).
 *
 * Polls /api/state every 500ms. Signature moment: when consensus is reached
 * the outcome renders in display-xl with a halo; before that the page is
 * pure terminal density (settler cards, status pills, tabular numbers).
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  DeliberationState,
  InjectQuestionResponse,
  SettlerView,
} from "@/lib/types";

const STATUS_TO_LABEL: Record<SettlerView["status"], string> = {
  idle: "idle",
  received: "question received",
  inferring: "running inference",
  voted: "vote signed",
  consensus: "consensus reached",
  posted: "posted on-chain",
};

const STATUS_TO_TONE: Record<SettlerView["status"], string> = {
  idle:      "border-ink-700 bg-ink-900/50 text-ink-400",
  received:  "border-accent-700/40 bg-accent-700/8 text-accent-300",
  inferring: "border-accent-500/40 bg-accent-500/8 text-accent-300 animate-pulse",
  voted:     "border-accent-600/60 bg-accent-700/10 text-accent-300",
  consensus: "border-accent-500 bg-accent-500/15 text-accent-200",
  posted:    "border-warn-500/60 bg-warn-500/10 text-warn-400",
};

function shortHex(s: string | undefined, head = 6, tail = 4): string {
  if (!s) return "—";
  const stripped = s.startsWith("0x") ? s.slice(2) : s;
  if (stripped.length <= head + tail) return s;
  return `${s.startsWith("0x") ? "0x" : ""}${stripped.slice(0, head)}…${stripped.slice(-tail)}`;
}

function explorerTxUrl(chainId: number | undefined, tx: string | undefined) {
  if (!tx) return null;
  if (chainId === 685689) {
    return `https://gensyn-mainnet.explorer.alchemy.com/tx/${tx}`;
  }
  return null;
}

interface FormState {
  prompt: string;
  outcomes: string;
  deadlineSecs: number;
}

const DEFAULT_FORM: FormState = {
  prompt: "Will the Bitcoin price exceed $200,000 at any point in 2026?",
  outcomes: "0,1",
  deadlineSecs: 180,
};

const SAMPLE_PROMPTS = [
  "Was the Bitcoin genesis block mined on January 3, 2009?",
  "Will the Bitcoin price exceed $200,000 at any point in 2026?",
  "Was the Ethereum Merge completed on September 15, 2022?",
];

type ProtocolStats = {
  questionsSettled: number;
  judgmentsMinted: number;
  transcriptsKB: number;
  registeredSettlerCount?: number;
  ensParent: string;
  storageNetwork: string;
};

function useProtocolStats() {
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/stats", { cache: "no-store" });
        if (r.ok && !cancelled) setStats((await r.json()) as ProtocolStats);
      } catch {
        /* tolerate */
      }
    };
    tick();
    const id = setInterval(tick, 12_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return stats;
}

/* ============================================================
   NAV — sticky, blur. Mark wordmark + 3 routes.
   ============================================================ */
function NavBar() {
  return (
    <nav className="sticky top-0 z-30 border-b border-ink-800/60 bg-ink-950/72 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-4">
        <a href="/" className="flex items-baseline gap-2 text-h4 font-semibold tracking-tight text-ink-50">
          <span>synod</span>
          <span className="num text-eyebrow font-normal uppercase tracking-[0.2em] text-ink-500">/0.1</span>
        </a>
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
    <a
      href={href}
      className="rounded-md px-3 py-1.5 text-caption text-ink-300 transition-colors hover:bg-ink-900 hover:text-ink-100"
    >
      {label}
    </a>
  );
}

/* ============================================================
   RECEIPT — signature mono block, original to Synod
   Looks like a printer receipt of protocol state. Receipts theme.
   ============================================================ */
function ProtocolReceipt({ stats }: { stats: ProtocolStats | null }) {
  const dash = "─".repeat(34);
  return (
    <div className="rounded-md border border-ink-700 bg-ink-900/50 p-6 font-mono text-caption text-ink-200">
      <div className="text-center text-ink-500">{dash}</div>
      <div className="mt-1 text-center">
        <span className="text-eyebrow uppercase tracking-[0.22em] text-ink-300">SYNOD RECEIPT</span>
      </div>
      <div className="text-center text-ink-500">{dash}</div>

      <div className="mt-4 flex flex-col gap-1.5">
        <ReceiptRow label="questions settled" value={stats?.questionsSettled} />
        <ReceiptRow label="judgments minted" value={stats?.judgmentsMinted} />
        <ReceiptRow
          label="0g storage"
          value={stats ? `${stats.transcriptsKB} kB` : undefined}
        />
        <ReceiptRow
          label="settlers"
          value={
            stats?.registeredSettlerCount !== undefined
              ? `${stats.registeredSettlerCount} · 2 cities`
              : undefined
          }
        />
      </div>

      <div className="mt-4 text-center text-ink-500">{dash}</div>
      <div className="mt-3 flex items-center justify-center gap-2">
        <span className="pulse-dot" aria-hidden />
        <span className="text-eyebrow uppercase tracking-[0.22em] text-accent-300">
          live · {stats?.ensParent ?? "synodai.eth"}
        </span>
      </div>
      <div className="mt-3 text-center text-ink-500">{dash}</div>
    </div>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string | number | undefined }) {
  const right = value === undefined || value === null ? "—" : String(value);
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-500">{label}</span>
      <span className="num text-ink-100">{right}</span>
    </div>
  );
}

/* ============================================================
   HERO — asymmetric: claim left, receipt right. Display-xl moment.
   ============================================================ */
function Hero({ stats }: { stats: ProtocolStats | null }) {
  return (
    <section className="grid gap-12 md:grid-cols-[3fr_2fr] md:gap-16 md:items-center">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <span className="pulse-dot" aria-hidden />
          <span className="text-eyebrow uppercase tracking-[0.22em] text-ink-400">
            AI Receipts · Ethereum · Gensyn L2 · 0G
          </span>
        </div>
        <h1 className="text-display font-semibold tracking-tight text-ink-50 md:text-display-xl">
          When AI says <span className="text-accent-400 halo-accent">yes</span>,
          <br className="hidden md:block" />
          {" "}prove it.
        </h1>
        <p className="max-w-xl text-body-lg text-ink-300">
          Multi-model AI quorum, signed end-to-end with ed25519 identities. Posted on Gensyn L2,
          anchored on 0G Storage, addressable on ENS. Read it, transfer it, contest it.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <a
            href="#try"
            className="rounded-md bg-accent-500 px-5 py-3 text-body-sm font-medium text-ink-950 transition-colors hover:bg-accent-400"
          >
            Submit a question
          </a>
          <a
            href="/gallery"
            className="rounded-md border border-ink-700 bg-ink-900/60 px-5 py-3 text-body-sm text-ink-200 transition-colors hover:border-accent-700 hover:text-accent-300"
          >
            See settled questions
          </a>
          <a
            href="/verify"
            className="rounded-md border border-ink-800 px-5 py-3 text-body-sm text-ink-300 transition-colors hover:border-accent-700 hover:text-accent-300"
          >
            Verify any proof →
          </a>
        </div>
      </div>
      <ProtocolReceipt stats={stats} />
    </section>
  );
}

/* ============================================================
   SECTION HEADER — eyebrow + h2 + optional sub + optional link
   ============================================================ */
function SectionHeader({
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
        <a
          href={link}
          className="ml-auto text-caption text-accent-300 transition-colors hover:text-accent-200"
        >
          {linkLabel ?? "See all →"}
        </a>
      )}
    </div>
  );
}

/* ============================================================
   RECENT JUDGMENTS — top 3 from /api/gallery
   ============================================================ */
type GalleryItem = {
  questionId: string;
  prompt: string;
  outcome: number | null;
  outcomeLabel: string;
  postedAt: number;
  transcript: { root: string; indexerUrl: string; bytes: number };
  judgment: { fqn: string; ensAppUrl: string } | null;
};

function RecentJudgments() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/gallery", { cache: "no-store" });
        if (r.ok && !cancelled) {
          const j = (await r.json()) as { items: GalleryItem[] };
          setItems(j.items?.slice(0, 3) ?? []);
        }
      } catch {
        /* tolerate */
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-ink-700 bg-ink-900/30 px-6 py-10 text-center text-body-sm text-ink-500">
        loading recent settlements…
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {items.map((it) => (
        <a
          key={it.questionId}
          href={`/verify?qid=${it.questionId.replace(/^0x/, "")}`}
          className="group flex flex-col gap-3 rounded-md border border-ink-700 bg-ink-900/40 p-5 transition-colors hover:border-accent-700/50 hover:bg-ink-900/60"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-eyebrow uppercase tracking-[0.18em] text-ink-500">settled</span>
            <span className="num text-micro text-ink-500">
              {it.transcript.bytes >= 1024
                ? `${(it.transcript.bytes / 1024).toFixed(1)} kB`
                : `${it.transcript.bytes} B`}
            </span>
          </div>
          <p className="line-clamp-3 text-body-sm leading-relaxed text-ink-100">
            {it.prompt || <span className="text-ink-500">[transcript loading]</span>}
          </p>
          <div className="mt-auto flex items-baseline gap-2 text-caption">
            <span className="text-ink-500">outcome</span>
            <span className="num text-h3 font-semibold text-accent-300">
              {it.outcomeLabel || (it.outcome !== null ? String(it.outcome) : "—")}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 border-t border-ink-800 pt-3 text-caption">
            <span className="text-ink-500 group-hover:text-ink-300 transition-colors">
              verify proof →
            </span>
            {it.judgment && (
              <code className="num truncate text-ink-400">{it.judgment.fqn}</code>
            )}
          </div>
        </a>
      ))}
    </div>
  );
}

/* ============================================================
   BUILT ON — 4 pillars with live data + outbound links
   ============================================================ */
function BuiltOn({ stats }: { stats: ProtocolStats | null }) {
  const pillars = [
    {
      name: "ENS",
      role: "Identity + Bootloader",
      detail: "synodai.eth resolves the registry, RPC, threshold, and the canonical settler list. Edit a record on mainnet, the UI swings.",
      stat: stats?.registeredSettlerCount ? `${stats.registeredSettlerCount} subnames` : "synodai.eth",
      url: "https://app.ens.domains/synodai.eth",
    },
    {
      name: "Gensyn AXL",
      role: "P2P transport",
      detail: "Encrypted Yggdrasil mesh between settlers. Two physical machines (Frankfurt + Toronto). End-to-end encrypted.",
      stat: "2 cities · 1 mesh",
      url: "/network",
    },
    {
      name: "0G Storage",
      role: "Decentralized memory",
      detail: "Every full deliberation transcript persisted on Galileo. Public HTTP retrieval. No SDK, no auth.",
      stat: stats ? `${stats.transcriptsKB} kB on chain` : "0G Galileo",
      url: "https://storagescan-galileo.0g.ai/",
    },
    {
      name: "Gensyn L2",
      role: "Settlement layer",
      detail: "Quorum-signed payloads recorded on chain 685689. Independent ed25519 verifier re-runs from raw bytes.",
      stat: "0xD387…b6ad",
      url: "https://gensyn-mainnet.explorer.alchemy.com/address/0xD387f749667590940d7c68CA350e57FbcE62b6ad",
    },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {pillars.map((p) => (
        <a
          key={p.name}
          href={p.url}
          target={p.url.startsWith("http") ? "_blank" : undefined}
          rel={p.url.startsWith("http") ? "noreferrer" : undefined}
          className="group flex flex-col gap-3 rounded-md border border-ink-700 bg-ink-900/40 p-5 transition-colors hover:border-accent-700/50 hover:bg-ink-900/60"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-h3 font-semibold tracking-tight text-ink-50">{p.name}</span>
            <span className="text-eyebrow uppercase tracking-[0.18em] text-ink-500">{p.role}</span>
          </div>
          <p className="text-body-sm leading-relaxed text-ink-300">{p.detail}</p>
          <div className="mt-auto flex items-baseline justify-between gap-2 border-t border-ink-800 pt-3 text-caption">
            <code className="num truncate text-ink-400">{p.stat}</code>
            <span className="text-ink-500 group-hover:text-accent-300 transition-colors">↗</span>
          </div>
        </a>
      ))}
    </div>
  );
}

/* ============================================================
   DEEP FOOTER — links, contracts, social
   ============================================================ */
function DeepFooter() {
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
          <span className="ml-auto">no claim of legal personhood for AI agents</span>
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

export default function HomePage() {
  const [state, setState] = useState<DeliberationState | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as DeliberationState;
      setState(j);
      if (j.consensus?.questionId) setActiveQuestionId(j.consensus.questionId);
    } catch {
      // swallow — UI tolerates transient backend hiccups during tests
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 500);
    return () => clearInterval(id);
  }, [refresh]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setSubmitError(null);
      try {
        const outcomes = form.outcomes
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n));
        const res = await fetch("/api/inject", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: form.prompt,
            outcomes,
            deadlineSecs: form.deadlineSecs,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error ?? `inject failed: HTTP ${res.status}`);
        }
        const j = (await res.json()) as InjectQuestionResponse;
        setActiveQuestionId(j.questionId);
        await refresh();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [form, refresh]
  );

  const settlers = useMemo(() => state?.settlers ?? [], [state]);
  const consensus = state?.consensus ?? null;
  const onchain = state?.onchain ?? {};
  const txUrl = explorerTxUrl(onchain.chainId, onchain.postedTxHash);
  const consensusReached = consensus?.outcome !== undefined;
  const stats = useProtocolStats();

  return (
    <>
      <NavBar />
      <main>
        {/* HERO — display-xl claim + receipt-motif live stats. The first impression. */}
        <section className="mx-auto max-w-7xl px-6 pt-12 pb-12 md:pt-20 md:pb-20">
          <Hero stats={stats} />
        </section>

        {/* TRY IT — inject form. The protocol is hands-on. */}
        <section id="try" className="mx-auto max-w-7xl px-6 pb-16">
          <SectionHeader
            eyebrow="Try the protocol"
            title="Submit a question"
            sub="The settler swarm picks it up over AXL, deliberates, and posts a quorum-signed result on-chain within ~60s."
          />
          <div className="rounded-md border border-ink-700 bg-ink-900/50 p-6">
            <form onSubmit={submit} className="flex flex-col gap-4">
              <textarea
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                rows={2}
                placeholder="Will protocol X reach $100M TVL by end of year?"
                className="w-full resize-none rounded-md border border-ink-700 bg-ink-950 px-4 py-3 text-body text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-500"
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-caption text-ink-400">
                  outcomes
                  <input
                    value={form.outcomes}
                    onChange={(e) => setForm({ ...form, outcomes: e.target.value })}
                    className="num w-32 rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <label className="flex items-center gap-2 text-caption text-ink-400">
                  deadline (s)
                  <input
                    type="number"
                    min={30}
                    max={3600}
                    value={form.deadlineSecs}
                    onChange={(e) => setForm({ ...form, deadlineSecs: Number(e.target.value) || 180 })}
                    className="num w-24 rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <button
                  type="submit"
                  disabled={submitting}
                  className="ml-auto rounded-md bg-accent-500 px-5 py-2 text-body-sm font-medium text-ink-950 transition-colors hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
                >
                  {submitting ? "injecting…" : "Inject question"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-ink-800/60 pt-3 text-caption">
                <span className="text-ink-500">samples:</span>
                {SAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setForm({ ...form, prompt: p })}
                    className="rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1 text-ink-400 transition-colors hover:border-accent-700 hover:text-accent-300"
                  >
                    {p.length > 60 ? `${p.slice(0, 60)}…` : p}
                  </button>
                ))}
              </div>
              {submitError && (
                <p className="rounded-md border border-alert-600 bg-alert-600/10 px-3 py-2 text-body-sm text-alert-400">
                  {submitError}
                </p>
              )}
            </form>
          </div>
        </section>

        {/* CONSENSUS SIGNATURE MOMENT — display-xl outcome with halo when reached */}
        {consensusReached && (
          <section className="mx-auto max-w-7xl px-6 pb-16">
            <div className="rounded-md border border-accent-700/60 bg-accent-700/10 px-8 py-12">
              <div className="flex flex-col items-center gap-3 md:flex-row md:items-center md:justify-between md:gap-12">
                <div className="flex flex-col items-center md:items-start">
                  <span className="text-eyebrow uppercase tracking-[0.22em] text-accent-300">
                    consensus outcome
                  </span>
                  <span className="halo-accent num text-display font-semibold tracking-tight text-accent-400 md:text-display-xl">
                    {consensus!.outcome}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-x-8 gap-y-1 text-center md:text-left">
                  <div className="flex flex-col">
                    <span className="text-eyebrow uppercase tracking-[0.18em] text-accent-400/80">quorum</span>
                    <span className="num text-h2 font-semibold text-ink-100">{consensus!.quorumSize ?? "—"}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-eyebrow uppercase tracking-[0.18em] text-accent-400/80">weighted</span>
                    <span className="num text-h2 font-semibold text-ink-100">
                      {consensus!.weightedScore?.toFixed(2) ?? "—"}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-eyebrow uppercase tracking-[0.18em] text-accent-400/80">settlers</span>
                    <span className="num text-h2 font-semibold text-ink-100">{settlers.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* DELIBERATION — settler cards, only when active */}
        {(settlers.length > 0 || consensus) && (
          <section className="mx-auto max-w-7xl px-6 pb-16">
            <SectionHeader
              eyebrow="In flight"
              title="Settler deliberation"
              sub={
                consensus
                  ? `${settlers.length} settlers responding to question ${shortHex(consensus.questionId, 8, 6)}.`
                  : "Tracking signed votes as they propagate over AXL."
              }
            />
            {consensus && (
              <div className="mb-4 rounded-md border border-ink-700 bg-ink-900/40 p-4">
                <p className="text-body text-ink-100">{consensus.prompt || "—"}</p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-caption text-ink-400">
                  <span>
                    question id <code className="num text-ink-200">{shortHex(consensus.questionId, 8, 6)}</code>
                  </span>
                  <span>
                    outcomes <code className="num text-ink-200">{consensus.outcomes.join(", ")}</code>
                  </span>
                  {consensus.quorumSize !== undefined && (
                    <span>
                      quorum so far <code className="num text-ink-200">{consensus.quorumSize}</code>
                    </span>
                  )}
                </div>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {settlers.map((s) => (
                <div key={s.pubkey} className={`rounded-md border p-4 transition ${STATUS_TO_TONE[s.status]}`}>
                  <div className="flex items-baseline justify-between">
                    <h3 className="num text-body-sm font-medium text-ink-100">{shortHex(s.pubkey, 8, 6)}</h3>
                    <span
                      className={`text-eyebrow uppercase tracking-[0.18em] ${
                        s.online ? "text-accent-400" : "text-ink-500"
                      }`}
                    >
                      {s.online ? "online" : "offline"}
                    </span>
                  </div>
                  <p className="mt-1 text-caption text-ink-400">{s.modelTag ?? "model: tbd"}</p>
                  <p className="mt-3 text-eyebrow uppercase tracking-[0.18em] text-current">
                    {STATUS_TO_LABEL[s.status]}
                  </p>
                  {s.votedOutcome !== undefined && (
                    <div className="mt-2 flex items-baseline gap-4 text-body-sm">
                      <span className="text-ink-400">
                        outcome <strong className="num text-ink-100">{s.votedOutcome}</strong>
                      </span>
                      {s.votedConfidence !== undefined && (
                        <span className="text-ink-400">
                          confidence <code className="num text-ink-100">{s.votedConfidence.toFixed(3)}</code>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ON-CHAIN RECEIPT — when settled */}
        {onchain.postedTxHash && (
          <section className="mx-auto max-w-7xl px-6 pb-16">
            <SectionHeader
              eyebrow="Settled"
              title="On-chain receipt"
              sub="Recomputed from raw signed-votes payload — the same logic any third party can run from the contract bytes."
            />
            <div className="rounded-md border border-warn-500/40 bg-warn-500/5 p-6">
              <div className="grid gap-3 text-body-sm sm:grid-cols-2 md:grid-cols-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-eyebrow uppercase tracking-[0.18em] text-ink-500">tx hash</span>
                  <div className="flex items-center gap-2">
                    <code className="num text-ink-100">{shortHex(onchain.postedTxHash, 10, 8)}</code>
                    {txUrl && (
                      <a href={txUrl} target="_blank" rel="noreferrer" className="text-caption text-accent-300 hover:text-accent-200">
                        view ↗
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-eyebrow uppercase tracking-[0.18em] text-ink-500">posted by</span>
                  <code className="num text-ink-100">{shortHex(onchain.postedBy)}</code>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-eyebrow uppercase tracking-[0.18em] text-ink-500">registry</span>
                  <code className="num text-ink-100">{shortHex(onchain.registryAddress)}</code>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-eyebrow uppercase tracking-[0.18em] text-ink-500">chain id</span>
                  <code className="num text-ink-100">{onchain.chainId ?? "—"}</code>
                </div>
              </div>
              {onchain.proof && (
                <div className="mt-5 border-t border-ink-700 pt-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-eyebrow uppercase tracking-[0.18em] text-ink-400">proof verification</h3>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-eyebrow uppercase tracking-[0.18em] ${
                        onchain.proof.status === "verified"
                          ? "border-accent-700 bg-accent-700/15 text-accent-300"
                          : "border-alert-600 bg-alert-600/15 text-alert-400"
                      }`}
                    >
                      {onchain.proof.status}
                    </span>
                  </div>
                  <div className="grid gap-2 text-caption sm:grid-cols-3">
                    <span className="text-ink-400">
                      winner votes <code className="num text-ink-100">{onchain.proof.winnerVotes ?? "—"}</code>
                    </span>
                    <span className="text-ink-400">
                      quorum required <code className="num text-ink-100">{onchain.proof.quorumSize ?? "—"}</code>
                    </span>
                    <span className="text-ink-400">
                      recomputed score <code className="num text-ink-100">{onchain.proof.weightedScoreScaled ?? "—"}</code>
                    </span>
                  </div>
                  {onchain.proof.errors.length > 0 && (
                    <ul className="mt-3 space-y-1 text-caption text-alert-400">
                      {onchain.proof.errors.slice(0, 4).map((err) => (
                        <li key={err}>{err}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {onchain.proof.votes.map((v) => (
                      <div key={v.pubkey} className="rounded-md border border-ink-700 bg-ink-950/50 p-3 text-caption">
                        <div className="flex items-center justify-between">
                          <code className="num text-ink-100">{shortHex(v.pubkey, 8, 6)}</code>
                          <span className={v.registered && v.signatureValid ? "text-accent-400" : "text-alert-400"}>
                            {v.registered && v.signatureValid ? "valid" : "invalid"}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-ink-400">
                          <span>outcome <span className="num text-ink-200">{v.outcome ?? "—"}</span></span>
                          <span>conf <span className="num text-ink-200">{v.confidence?.toFixed(3) ?? "—"}</span></span>
                          <span className="text-ink-500">{v.modelTag ?? "model unknown"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* RECENT JUDGMENTS — top 3 from /api/gallery */}
        <section className="mx-auto max-w-7xl px-6 pb-16">
          <SectionHeader
            eyebrow="History"
            title="Recent settlements"
            sub="Every settled question is queryable, transferable, and recoverable from public infrastructure."
            link="/gallery"
            linkLabel="Full gallery →"
          />
          <RecentJudgments />
        </section>

        {/* BUILT ON — 4 pillars */}
        <section className="mx-auto max-w-7xl px-6 pb-16">
          <SectionHeader
            eyebrow="Stack"
            title="Built on"
            sub="Each layer carries a specific job. None are decoration — pull one and the system breaks."
          />
          <BuiltOn stats={stats} />
        </section>
      </main>
      <DeepFooter />
    </>
  );
}
