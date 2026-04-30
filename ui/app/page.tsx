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
import { DeepFooter, NavBar, SectionHeader } from "@/lib/site-chrome";

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

const STATS_CACHE_KEY = "synod:lastStats";

function useProtocolStats() {
  // Hydrate from localStorage so the receipt + counters render with last-known
  // values immediately on cold-paint instead of "—" placeholders. Fresh fetch
  // overwrites within the first 200ms typically.
  const [stats, setStats] = useState<ProtocolStats | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STATS_CACHE_KEY);
      return raw ? (JSON.parse(raw) as ProtocolStats) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/stats", { cache: "no-store" });
        if (r.ok && !cancelled) {
          const fresh = (await r.json()) as ProtocolStats;
          setStats(fresh);
          try {
            window.localStorage.setItem(STATS_CACHE_KEY, JSON.stringify(fresh));
          } catch {
            /* private mode etc. */
          }
        }
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
      <div className="mt-3 flex flex-col items-center gap-2">
        <span className="text-eyebrow uppercase tracking-[0.22em] text-ink-500">
          settlement velocity · 14d
        </span>
        <SettlementSparkline />
      </div>
      <div className="mt-3 text-center text-ink-500">{dash}</div>
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

function SettlementSparkline() {
  const [bins, setBins] = useState<number[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/gallery", { cache: "no-store" });
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as { items: { postedAt: number }[] };
        // Group by day for the last 14 days
        const days = 14;
        const now = Math.floor(Date.now() / 1000);
        const dayStart = now - days * 24 * 3600;
        const counts = new Array<number>(days).fill(0);
        for (const it of j.items ?? []) {
          if (typeof it.postedAt !== "number") continue;
          if (it.postedAt < dayStart) continue;
          const idx = Math.min(days - 1, Math.floor((it.postedAt - dayStart) / (24 * 3600)));
          counts[idx] += 1;
        }
        if (!cancelled) setBins(counts);
      } catch {
        /* tolerate */
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!bins) {
    return <div aria-hidden className="h-8 w-full animate-pulse rounded-sm bg-ink-800" />;
  }

  const max = Math.max(1, ...bins);
  const w = 220;
  const h = 36;
  const barW = w / bins.length - 2;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full">
      {bins.map((c, i) => {
        const barH = (c / max) * (h - 4);
        const x = i * (barW + 2);
        const y = h - barH;
        const isToday = i === bins.length - 1;
        const fill = c === 0 ? "rgb(40, 47, 60)" : isToday ? "rgb(0, 229, 160)" : "rgb(0, 130, 89)";
        return (
          <rect
            key={i}
            x={x}
            y={c === 0 ? h - 1 : y}
            width={barW}
            height={c === 0 ? 1 : barH}
            fill={fill}
            opacity={c === 0 ? 0.6 : 0.95}
            rx={1}
          />
        );
      })}
    </svg>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string | number | undefined }) {
  const isEmpty = value === undefined || value === null;
  const display = isEmpty ? "" : String(value);
  // Briefly highlight the cell when its rendered value changes — gives the
  // counter a subtle "tick" feel when stats refresh.
  const [flashKey, setFlashKey] = useState(display);
  useEffect(() => {
    if (display && display !== flashKey) setFlashKey(display);
  }, [display, flashKey]);
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-500">{label}</span>
      {isEmpty ? (
        <span
          aria-hidden
          className="h-3 w-16 animate-pulse rounded-sm bg-ink-700"
          title="loading…"
        />
      ) : (
        <span key={flashKey} className="num flash-on-update rounded px-1 text-ink-100">
          {display}
        </span>
      )}
    </div>
  );
}

/* ============================================================
   HERO — asymmetric: claim left, receipt right. Display-xl moment.
   ============================================================ */
function Hero({ stats }: { stats: ProtocolStats | null }) {
  return (
    <section className="grid gap-10 md:grid-cols-[3fr_2fr] md:gap-16 md:items-center">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <span className="pulse-dot" aria-hidden />
          <span className="text-eyebrow uppercase tracking-[0.22em] text-ink-400">
            AI Receipts · Live on Ethereum, Gensyn L2, 0G
          </span>
        </div>
        <h1 className="text-h1 font-semibold tracking-tight text-ink-50 sm:text-display md:text-display-xl">
          AI verdicts,
          <br className="hidden sm:block" />
          {" "}signed &amp; <span className="text-accent-400 halo-accent">addressable</span>.
        </h1>
        <p className="max-w-xl text-body-lg text-ink-300">
          When N AI models agree on a question, the verdict is signed end-to-end with ed25519,
          posted on Gensyn L2, anchored on 0G Storage, and minted as a transferable ENS subname.
          Read it, verify it, transfer it.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <a
            href="#try"
            className="rounded-md bg-accent-500 px-5 py-3 text-body-sm font-medium text-ink-950 transition-colors hover:bg-accent-400"
          >
            Settle a question
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
   LIVE MESH STRIP — preview of /network on the homepage
   Shows 4 settlers with live cross-checks. Clicks through to /network.
   ============================================================ */
type NetworkNode = {
  spec: { name: string; ensFqn?: string; ensRole?: string };
  online: boolean;
  registered: boolean;
  pubkeyMatchesEns?: boolean;
};
type NetworkSnapshot = {
  registeredSettlerCount?: number;
  ensSubnameCount?: number;
  configSource?: string;
  ensParent?: string;
  nodes: NetworkNode[];
  edges: { from: string; to: string; up: boolean }[];
};

function LiveMeshStrip() {
  const [view, setView] = useState<NetworkSnapshot | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/network", { cache: "no-store" });
        if (r.ok && !cancelled) setView((await r.json()) as NetworkSnapshot);
      } catch {
        /* tolerate */
      }
    };
    tick();
    const id = setInterval(tick, 8_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const nodes = view?.nodes ?? [];
  const verifiedCount = nodes.filter((n) => n.online && n.registered && n.pubkeyMatchesEns).length;
  const totalCount = nodes.length;

  return (
    <div className="rounded-md border border-ink-700 bg-ink-900/40 p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="pulse-dot" aria-hidden />
          <span className="text-eyebrow uppercase tracking-[0.22em] text-accent-300">
            AXL mesh · live
          </span>
        </div>
        <a
          href="/network"
          className="text-caption text-ink-300 transition-colors hover:text-accent-300"
        >
          full topology →
        </a>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-[auto_1fr] md:items-center md:gap-8">
        <MeshSvg nodes={nodes} />
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <span className="num text-display font-semibold tracking-tight text-accent-400">
              {totalCount > 0 ? `${verifiedCount}/${totalCount}` : "—"}
            </span>
            <span className="text-body-sm text-ink-300">
              settlers verified on-chain &amp; meshed across two cities
            </span>
          </div>
          <div className="grid gap-1.5 text-caption md:grid-cols-2">
            {nodes.length === 0
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-4 w-full animate-pulse rounded-sm bg-ink-800" />
                ))
              : nodes.map((n) => {
                  const ok = n.online && n.registered && n.pubkeyMatchesEns;
                  return (
                    <div key={n.spec.name} className="flex items-center gap-2 truncate">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-md ${
                          ok ? "bg-accent-500" : "bg-warn-500"
                        }`}
                        aria-hidden
                      />
                      <code className="num truncate text-ink-200">
                        {n.spec.ensFqn ?? `settler-${n.spec.name.toLowerCase()}.synodai.eth`}
                      </code>
                      <span className="ml-auto truncate text-ink-500">
                        {n.spec.ensRole ?? "-"}
                      </span>
                    </div>
                  );
                })}
          </div>
          <div className="border-t border-ink-800 pt-2 text-micro text-ink-500">
            source: <code className="num text-ink-300">{view?.ensParent ?? "synodai.eth"}</code>
            {" · "}registry <code className="num text-ink-300">{view?.registeredSettlerCount ?? "—"}</code>
            {" · "}ens <code className="num text-ink-300">{view?.ensSubnameCount ?? "—"}</code>
          </div>
        </div>
      </div>
    </div>
  );
}

function MeshSvg({ nodes }: { nodes: NetworkNode[] }) {
  // 4-position layout. A is the hub; B/C are co-located in Frankfurt; D is in Toronto.
  const pos: Record<string, { x: number; y: number }> = {
    A: { x: 80, y: 28 },
    B: { x: 28, y: 92 },
    C: { x: 132, y: 92 },
    D: { x: 80, y: 156 },
  };
  // For an idle initial render we still draw the topology (greyed out)
  const drawn = nodes.length > 0 ? nodes : [
    { spec: { name: "A" }, online: false, registered: false, pubkeyMatchesEns: false },
    { spec: { name: "B" }, online: false, registered: false, pubkeyMatchesEns: false },
    { spec: { name: "C" }, online: false, registered: false, pubkeyMatchesEns: false },
    { spec: { name: "D" }, online: false, registered: false, pubkeyMatchesEns: false },
  ];
  // Edges: every node ↔ A, plus B↔C, plus D↔A across cities (highlight)
  const edges = [
    { from: "A", to: "B" },
    { from: "A", to: "C" },
    { from: "A", to: "D", crossCity: true },
    { from: "B", to: "C" },
  ];
  return (
    <svg viewBox="0 0 160 184" className="h-44 w-44 shrink-0">
      {edges.map((e, i) => {
        const a = pos[e.from];
        const b = pos[e.to];
        const aOK = drawn.find((n) => n.spec.name === e.from)?.online;
        const bOK = drawn.find((n) => n.spec.name === e.to)?.online;
        const up = !!(aOK && bOK);
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={up ? "rgb(0, 229, 160)" : "rgb(68, 78, 97)"}
            strokeWidth={up ? 1.6 : 1}
            strokeDasharray={up ? "" : "3 3"}
            style={up ? { filter: "drop-shadow(0 0 6px rgba(0,229,160,0.55))" } : undefined}
          />
        );
      })}
      {drawn.map((n) => {
        const p = pos[n.spec.name];
        if (!p) return null;
        const ok = n.online && n.registered && n.pubkeyMatchesEns;
        const fill = ok ? "rgb(0, 229, 160)" : "rgb(108, 118, 137)";
        return (
          <g key={n.spec.name}>
            <circle
              cx={p.x}
              cy={p.y}
              r={11}
              fill={fill}
              fillOpacity={ok ? 0.18 : 0.08}
              stroke={fill}
              strokeWidth={1.5}
            />
            <text
              x={p.x}
              y={p.y + 4}
              textAnchor="middle"
              fontSize={11}
              fill={fill}
              fontWeight={600}
              fontFamily="var(--font-geist-mono)"
            >
              {n.spec.name}
            </text>
          </g>
        );
      })}
      {/* City labels */}
      <text x={28} y={120} fontSize={7} fill="rgb(108, 118, 137)" fontFamily="var(--font-geist-mono)">FRA</text>
      <text x={132} y={120} fontSize={7} fill="rgb(108, 118, 137)" fontFamily="var(--font-geist-mono)" textAnchor="end">FRA</text>
      <text x={80} y={178} fontSize={7} fill="rgb(108, 118, 137)" fontFamily="var(--font-geist-mono)" textAnchor="middle">YYZ</text>
      <text x={80} y={20} fontSize={7} fill="rgb(108, 118, 137)" fontFamily="var(--font-geist-mono)" textAnchor="middle">FRA</text>
    </svg>
  );
}

/* ============================================================
   LATEST SETTLEMENT SPOTLIGHT — featured hero card pulling from /api/gallery
   So the idle homepage feels alive (without anyone submitting a question)
   ============================================================ */
function LatestSettlement() {
  const [item, setItem] = useState<GalleryItem | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/gallery", { cache: "no-store" });
        if (r.ok && !cancelled) {
          const j = (await r.json()) as { items: GalleryItem[] };
          // Pick the most recent settled item that has a real prompt.
          const ready = j.items?.find((x) => x.prompt && x.prompt.length > 0) ?? null;
          setItem(ready);
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

  if (!item) {
    // Skeleton so the layout doesn't pop
    return (
      <div className="rounded-md border border-ink-700 bg-ink-900/40 p-6 md:p-8">
        <div className="flex items-baseline justify-between gap-3">
          <div className="h-2 w-24 animate-pulse rounded-sm bg-ink-700" />
          <div className="h-2 w-16 animate-pulse rounded-sm bg-ink-700" />
        </div>
        <div className="mt-4 grid gap-6 md:grid-cols-[2fr_1fr] md:items-center">
          <div className="flex flex-col gap-2">
            <div className="h-4 w-full animate-pulse rounded-sm bg-ink-800" />
            <div className="h-4 w-5/6 animate-pulse rounded-sm bg-ink-800" />
            <div className="h-4 w-3/4 animate-pulse rounded-sm bg-ink-800" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-12 w-24 animate-pulse rounded-sm bg-ink-700" />
            <div className="h-3 w-32 animate-pulse rounded-sm bg-ink-700" />
          </div>
        </div>
      </div>
    );
  }

  const ago = Math.max(0, Math.floor((Date.now() / 1000 - item.postedAt)));
  const agoLabel =
    ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.floor(ago / 60)}m ago` : `${Math.floor(ago / 3600)}h ago`;
  const qid = item.questionId.replace(/^0x/, "");

  return (
    <div className="rounded-md border border-accent-700/40 bg-accent-700/[0.04] p-6 md:p-8">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="pulse-dot" aria-hidden />
          <span className="text-eyebrow uppercase tracking-[0.22em] text-accent-300">
            most recent settlement
          </span>
        </div>
        <span className="num text-micro text-ink-500">{agoLabel}</span>
      </div>
      <div className="mt-5 grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex flex-col gap-3">
          <p className="text-body-lg leading-relaxed text-ink-100">{item.prompt}</p>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-caption text-ink-500">
            <span>
              question id <code className="num text-ink-300">0x{qid.slice(0, 8)}…{qid.slice(-6)}</code>
            </span>
            <span>
              transcript {(item.transcript.bytes / 1024).toFixed(1)} kB on 0G
            </span>
          </div>
        </div>
        <div className="flex flex-col items-start gap-1 md:items-end md:text-right">
          <span className="text-eyebrow uppercase tracking-[0.22em] text-accent-300">
            outcome
          </span>
          <span className="halo-accent num text-display font-semibold tracking-tight text-accent-400">
            {item.outcomeLabel || (item.outcome !== null ? String(item.outcome) : "—")}
          </span>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ink-800/60 pt-4 text-caption">
        <a
          href={`/verify?qid=${qid}`}
          className="rounded-md border border-accent-700/50 bg-accent-700/10 px-3 py-1.5 text-accent-300 transition-colors hover:bg-accent-700/20"
        >
          verify proof →
        </a>
        <a
          href={item.transcript.indexerUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-ink-700 bg-ink-900/60 px-3 py-1.5 text-ink-300 transition-colors hover:border-accent-700/50 hover:text-accent-200"
        >
          fetch transcript ↗
        </a>
        {item.judgment && (
          <a
            href={item.judgment.ensAppUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-ink-700 bg-ink-900/60 px-3 py-1.5 text-ink-300 transition-colors hover:border-accent-700/50 hover:text-accent-200"
          >
            <code className="num">{item.judgment.fqn}</code> ↗
          </a>
        )}
        <span className="ml-auto text-ink-500">posted on Gensyn L2 · transcript on 0G Storage</span>
      </div>
    </div>
  );
}

/* ============================================================
   HOW IT WORKS — 3 steps, each ties to a specific layer
   ============================================================ */
function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Question in",
      detail:
        "A prompt enters the network. The settler swarm — Sonnet, Haiku, Gemini, Opus — picks it up over Gensyn AXL, an encrypted Yggdrasil mesh. No central coordinator.",
      tag: "AXL P2P",
    },
    {
      n: "02",
      title: "Quorum out",
      detail:
        "Each settler reasons independently and signs its vote with its ed25519 identity. Per-outcome quorum: the winning answer needs N votes for that answer — not just N total — which holds against single-node prompt injection.",
      tag: "ed25519 sigs",
    },
    {
      n: "03",
      title: "Receipt minted",
      detail:
        "The quorum-signed payload posts on Gensyn L2. The full transcript persists to 0G Storage, retrievable via public HTTP. The verdict is minted as j-{hash}.synodai.eth — addressable, transferable, and tied to the on-chain tx.",
      tag: "L2 + 0G + ENS",
    },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {steps.map((s, i) => (
        <div
          key={s.n}
          className="relative flex flex-col gap-3 rounded-md border border-ink-700 bg-ink-900/40 p-6"
        >
          {/* hairline arrow connector between cards on desktop */}
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className="absolute -right-2 top-1/2 hidden h-0.5 w-3 -translate-y-1/2 bg-ink-700 md:block"
            />
          )}
          <div className="flex items-baseline justify-between">
            <span className="num text-h1 font-semibold tracking-tight text-accent-400/40">{s.n}</span>
            <span className="text-eyebrow uppercase tracking-[0.2em] text-ink-500">{s.tag}</span>
          </div>
          <h3 className="text-h3 font-semibold tracking-tight text-ink-50">{s.title}</h3>
          <p className="text-body-sm leading-relaxed text-ink-300">{s.detail}</p>
        </div>
      ))}
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

const RECENT_CACHE_KEY = "synod:lastRecent";

function RecentJudgments() {
  const [items, setItems] = useState<GalleryItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(RECENT_CACHE_KEY);
      return raw ? (JSON.parse(raw) as GalleryItem[]) : [];
    } catch {
      return [];
    }
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/gallery", { cache: "no-store" });
        if (r.ok && !cancelled) {
          const j = (await r.json()) as { items: GalleryItem[] };
          const trimmed = j.items?.slice(0, 3) ?? [];
          setItems(trimmed);
          setLoaded(true);
          try {
            window.localStorage.setItem(RECENT_CACHE_KEY, JSON.stringify(trimmed));
          } catch {
            /* private mode etc. */
          }
        }
      } catch {
        /* tolerate */
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (items.length === 0) {
    // Shimmer skeleton cards — preserves layout, no jarring empty state
    return (
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-md border border-ink-700 bg-ink-900/40 p-5"
          >
            <div className="flex items-baseline justify-between">
              <div className="h-2 w-16 animate-pulse rounded-sm bg-ink-700" />
              <div className="h-2 w-10 animate-pulse rounded-sm bg-ink-700" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="h-3 w-full animate-pulse rounded-sm bg-ink-800" />
              <div className="h-3 w-5/6 animate-pulse rounded-sm bg-ink-800" />
              <div className="h-3 w-3/4 animate-pulse rounded-sm bg-ink-800" />
            </div>
            <div className="mt-auto flex items-baseline gap-2">
              <div className="h-2 w-12 animate-pulse rounded-sm bg-ink-700" />
              <div className="h-5 w-8 animate-pulse rounded-sm bg-ink-700" />
            </div>
            <div className="border-t border-ink-800 pt-3">
              <div className="h-2 w-20 animate-pulse rounded-sm bg-ink-700" />
            </div>
          </div>
        ))}
        {!loaded && (
          <div className="col-span-full text-center text-micro text-ink-500">
            loading recent settlements from on-chain + 0G…
          </div>
        )}
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
      mark: "ξ",
      tone: "rgb(91, 130, 255)",
    },
    {
      name: "Gensyn AXL",
      role: "P2P transport",
      detail: "Encrypted Yggdrasil mesh between settlers. Two physical machines (Frankfurt + Toronto). End-to-end encrypted.",
      stat: "2 cities · 1 mesh",
      url: "/network",
      mark: "△",
      tone: "rgb(255, 145, 90)",
    },
    {
      name: "0G Storage",
      role: "Decentralized memory",
      detail: "Every full deliberation transcript persisted on Galileo. Public HTTP retrieval. No SDK, no auth.",
      stat: stats ? `${stats.transcriptsKB} kB on chain` : "0G Galileo",
      url: "https://storagescan-galileo.0g.ai/",
      mark: "◇",
      tone: "rgb(0, 229, 160)",
    },
    {
      name: "Gensyn L2",
      role: "Settlement layer",
      detail: "Quorum-signed payloads recorded on chain 685689. Independent ed25519 verifier re-runs from raw bytes.",
      stat: "0xD387…b6ad",
      url: "https://gensyn-mainnet.explorer.alchemy.com/address/0xD387f749667590940d7c68CA350e57FbcE62b6ad",
      mark: "◯",
      tone: "rgb(184, 138, 255)",
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
          className="group relative flex flex-col gap-3 overflow-hidden rounded-md border border-ink-700 bg-ink-900/40 p-5 transition-colors hover:border-accent-700/50 hover:bg-ink-900/60"
        >
          {/* partner accent bar — subtle vertical strip on the left edge */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-0.5 opacity-60 transition-opacity group-hover:opacity-100"
            style={{ backgroundColor: p.tone }}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span
                className="num text-h3 leading-none"
                style={{ color: p.tone }}
                aria-hidden
              >
                {p.mark}
              </span>
              <span className="text-h3 font-semibold tracking-tight text-ink-50">{p.name}</span>
            </div>
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
    // 2s tick — fast enough that the deliberation feels live, slow enough
    // that we don't pound the on-chain RPC under demo load.
    const id = setInterval(refresh, 2000);
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
        <section className="mx-auto max-w-7xl px-6 pt-12 pb-12 md:pt-20 md:pb-16">
          <Hero stats={stats} />
        </section>

        {/* LIVE MESH STRIP — preview of /network without leaving the homepage */}
        <section className="mx-auto max-w-7xl px-6 pb-12">
          <LiveMeshStrip />
        </section>

        {/* LATEST SETTLEMENT — what just happened. Idle visitors see real protocol activity. */}
        <section className="mx-auto max-w-7xl px-6 pb-16">
          <LatestSettlement />
        </section>

        {/* HOW IT WORKS — 3-step explainer with ties to each layer */}
        <section className="border-y border-ink-800/40 bg-ink-900/20">
          <div className="mx-auto max-w-7xl px-6 py-16">
            <SectionHeader
              eyebrow="How it works"
              title="From question to receipt in 3 steps"
              sub="Every question follows the same path. Each step ties to a specific layer of the stack."
            />
            <HowItWorks />
          </div>
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
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-ink-800/60 pt-3 text-caption">
                <span className="text-ink-500">avg settle ~60s · ed25519 signed · auto-anchored to 0G</span>
              </div>
              <div className="flex flex-wrap gap-2 text-caption">
                <span className="text-ink-500">try one:</span>
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
        <section className="border-y border-ink-800/40 bg-ink-900/20">
          <div className="mx-auto max-w-7xl px-6 py-16">
            <SectionHeader
              eyebrow="Stack"
              title="Built on"
              sub="Each layer carries a specific job. None are decoration — pull one and the system breaks."
            />
            <BuiltOn stats={stats} />
          </div>
        </section>
      </main>
      <DeepFooter />
    </>
  );
}
