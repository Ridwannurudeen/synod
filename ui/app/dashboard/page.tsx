/**
 * /dashboard — public, no-auth, auto-updating live stats panel.
 *
 * Etherscan-for-Synod: chain-canonical settlement count from
 * eth_getLogs(SettlementRecorded), per-settler agreement, recent
 * settlements with verify-deeplinks, 0G storage totals, ENS bootloader
 * health. Polls /api/dashboard every 30s.
 *
 * Design language matches /network — terminal archetype, ink palette,
 * tabular-nums, halo on the signature moment (settlements all-time
 * when > 0).
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { DeepFooter, LiveTicker, NavBar, PageHeader } from "@/lib/site-chrome";

const POLL_MS = 30_000;
const HALO_THRESHOLD = 5;

type SettlerStats = {
  name: string;
  ensFqn: string;
  evmAddress: string;
  axlPubkey: string;
  modelTag: string;
  online: boolean;
  registered: boolean;
  appearances: number;
  agreedWithConsensus: number;
  agreementRate: number | null;
  lastVoteAtMs: number | null;
};

type DashboardView = {
  generatedAtMs: number;
  network: {
    chainId: number;
    registryAddress: string;
    rpcUrl: string;
    settlementsAllTime: number;
    settlementsLast24h: number;
    avgTimeToConsensusMs: number | null;
    meshEdgeCount: number;
  };
  settlers: SettlerStats[];
  recentSettlements: Array<{
    questionId: string;
    outcome: number;
    quorumSize: number;
    weightedScoreScaled: number;
    postedBy: string;
    txHash: string;
    blockNumber: number;
    timestamp: number;
    judgmentSubname?: string;
  }>;
  storage: {
    network: string;
    indexerUrl: string;
    transcriptCount: number;
    transcriptBytes: number;
    sampleRoot: string | null;
  };
  ens: {
    parent: string;
    source: "ens" | "fallback";
    parentRecordCount: number;
    subnameCount: number;
    threshold: number;
  };
  totalWeightedScoreScaled: number;
};

function shortHex(s: string | undefined, head = 8, tail = 6): string {
  if (!s) return "—";
  const stripped = s.startsWith("0x") ? s.slice(2) : s;
  if (stripped.length <= head + tail + 1) return s;
  return `${s.startsWith("0x") ? "0x" : ""}${stripped.slice(0, head)}…${stripped.slice(-tail)}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

function timeAgo(ts: number): string {
  if (!ts) return "—";
  const diff = Math.max(0, Date.now() / 1000 - ts);
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function timeAgoMs(ms: number | null): string {
  if (ms === null) return "—";
  return timeAgo(Math.floor(ms / 1000));
}

function explorerTxUrl(chainId: number, tx: string): string | null {
  if (chainId === 685689) {
    return `https://gensyn-mainnet.explorer.alchemy.com/tx/${tx}`;
  }
  return null;
}

function HeroStrip({ view }: { view: DashboardView }) {
  const allTime = view.network.settlementsAllTime;
  const halo = allTime >= HALO_THRESHOLD;
  const settlersActive = view.settlers.filter((s) => s.online && s.registered).length;
  const totalScore = (view.totalWeightedScoreScaled / 1_000_000).toFixed(2);

  return (
    <section className="rounded-md border border-accent-700 bg-accent-700/8 px-6 py-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-12">
        <div className="flex flex-col items-start gap-2">
          <span className="text-eyebrow uppercase tracking-[0.22em] text-accent-400">
            settlements recorded on-chain
          </span>
          <span
            className={`num text-display font-semibold tracking-tight md:text-display-xl ${
              halo ? "halo-accent text-accent-400" : "text-ink-100"
            }`}
          >
            {allTime}
          </span>
          <span className="text-body-sm text-accent-300/80">
            chain-canonical · eth_getLogs(SettlementRecorded)
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 md:gap-6">
          <SignatureStat label="settlers active" value={settlersActive} />
          <SignatureStat
            label="transcripts on 0G"
            value={view.storage.transcriptCount}
          />
          <SignatureStat
            label="weighted score Σ"
            value={totalScore}
            mono
          />
        </div>
      </div>
    </section>
  );
}

function SignatureStat({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: number | string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-eyebrow uppercase tracking-wide text-ink-500">{label}</span>
      <span className={`${mono ? "num" : ""} text-h2 font-semibold text-ink-100`}>
        {value}
      </span>
    </div>
  );
}

function NetworkHealth({ view }: { view: DashboardView }) {
  const ratePerHour =
    view.network.settlementsLast24h > 0
      ? (view.network.settlementsLast24h / 24).toFixed(2)
      : "0.00";
  return (
    <section className="rounded-md border border-ink-700 bg-ink-900/50 p-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="pulse-dot" aria-hidden />
        <h2 className="text-eyebrow uppercase tracking-[0.22em] text-ink-400">
          network health
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="settlements (24h)" value={view.network.settlementsLast24h} />
        <StatTile label="rate / hour" value={ratePerHour} />
        <StatTile label="mesh edges" value={view.network.meshEdgeCount} />
        <StatTile
          label="median ttc"
          value={
            view.network.avgTimeToConsensusMs !== null
              ? `${(view.network.avgTimeToConsensusMs / 1000).toFixed(1)}s`
              : "—"
          }
          dim={view.network.avgTimeToConsensusMs === null}
        />
      </div>
      {view.network.avgTimeToConsensusMs === null && (
        <p className="mt-3 text-micro text-ink-500">
          time-to-consensus requires per-settlement off-chain anchors — wired in v1.1.
        </p>
      )}
    </section>
  );
}

function StatTile({
  label,
  value,
  dim = false,
}: {
  label: string;
  value: string | number;
  dim?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-ink-700 bg-ink-900/40 px-4 py-3">
      <span className="text-eyebrow uppercase tracking-wide text-ink-500">{label}</span>
      <span className={`num text-h3 font-semibold ${dim ? "text-ink-500" : "text-ink-100"}`}>
        {value}
      </span>
    </div>
  );
}

function SettlerCard({ s }: { s: SettlerStats }) {
  const tone = !s.online ? "alert" : !s.registered ? "warn" : "accent";
  const dotCls =
    tone === "accent" ? "" : tone === "warn" ? "pulse-dot-warn" : "pulse-dot-alert";
  return (
    <div className="rounded-md border border-ink-700 bg-ink-900/60 p-5 transition-colors hover:border-ink-600">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-h2 font-semibold tracking-tight text-ink-100">{s.name}</span>
          <span className={`pulse-dot ${dotCls}`} aria-hidden />
        </div>
        <span className="text-eyebrow uppercase tracking-wide text-ink-500">
          {s.modelTag || "—"}
        </span>
      </div>

      {s.ensFqn && (
        <div className="mt-3 flex items-center gap-2 rounded border border-accent-700/40 bg-accent-700/8 px-2 py-1.5">
          <span className="text-eyebrow uppercase tracking-wide text-accent-400">ens</span>
          <code className="num text-caption text-accent-300">{s.ensFqn}</code>
        </div>
      )}

      <dl className="mt-5 grid grid-cols-[6.5rem_1fr] gap-y-1.5 text-caption">
        <Field k="evm" v={shortHex(s.evmAddress, 10, 8)} />
        <Field k="axl pubkey" v={shortHex(s.axlPubkey, 10, 8)} dim />
        <Field
          k="appearances"
          v={s.appearances === 0 ? "—" : String(s.appearances)}
        />
        <Field
          k="agreement"
          v={
            s.appearances === 0
              ? "—"
              : `${s.agreedWithConsensus}/${s.appearances}${
                  s.agreementRate !== null
                    ? ` · ${Math.round(s.agreementRate * 100)}%`
                    : ""
                }`
          }
        />
        <Field k="last vote" v={timeAgoMs(s.lastVoteAtMs)} dim />
      </dl>
    </div>
  );
}

function Field({ k, v, dim = false }: { k: string; v: string; dim?: boolean }) {
  return (
    <>
      <dt className="text-ink-500">{k}</dt>
      <dd className={`num ${dim ? "text-ink-400" : "text-ink-200"}`}>{v}</dd>
    </>
  );
}

function RecentSettlements({ view }: { view: DashboardView }) {
  const rows = view.recentSettlements;
  if (rows.length === 0) {
    return (
      <section>
        <h2 className="mb-3 text-eyebrow uppercase tracking-[0.22em] text-ink-400">
          recent settlements
        </h2>
        <div className="rounded-md border border-dashed border-ink-700 bg-ink-900/30 px-4 py-8 text-center text-body-sm text-ink-500">
          no SettlementRecorded events yet on-chain.
        </div>
      </section>
    );
  }
  return (
    <section>
      <h2 className="mb-3 text-eyebrow uppercase tracking-[0.22em] text-ink-400">
        recent settlements <span className="num text-ink-500">· last {rows.length}</span>
      </h2>
      <div className="overflow-x-auto rounded-md border border-ink-700 bg-ink-900/50">
        <table className="w-full text-caption">
          <thead className="border-b border-ink-700/60 bg-ink-900/80 text-ink-500">
            <tr>
              <Th>question</Th>
              <Th>outcome</Th>
              <Th>quorum</Th>
              <Th>score</Th>
              <Th>posted by</Th>
              <Th>tx</Th>
              <Th>judgment</Th>
              <Th>when</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const qidShort = shortHex(r.questionId, 8, 6);
              const verifyUrl = `/verify?qid=${r.questionId.replace(/^0x/, "")}`;
              const txUrl = explorerTxUrl(view.network.chainId, r.txHash);
              return (
                <tr
                  key={r.questionId}
                  className="border-b border-ink-800/60 transition-colors hover:bg-ink-800/40"
                >
                  <td className="px-3 py-2.5">
                    <Link href={verifyUrl} className="num text-accent-300 hover:text-accent-200">
                      {qidShort}
                    </Link>
                  </td>
                  <td className="num px-3 py-2.5 text-ink-100">{r.outcome}</td>
                  <td className="num px-3 py-2.5 text-ink-200">{r.quorumSize}</td>
                  <td className="num px-3 py-2.5 text-ink-200">
                    {(r.weightedScoreScaled / 1_000_000).toFixed(3)}
                  </td>
                  <td className="num px-3 py-2.5 text-ink-300">
                    {shortHex(r.postedBy, 6, 4)}
                  </td>
                  <td className="num px-3 py-2.5">
                    {txUrl ? (
                      <a
                        href={txUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-300 hover:text-accent-200"
                      >
                        {shortHex(r.txHash, 6, 4)} ↗
                      </a>
                    ) : (
                      <span className="text-ink-300">{shortHex(r.txHash, 6, 4)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-ink-300">
                    {r.judgmentSubname ? (
                      <code className="num text-accent-400">{r.judgmentSubname}</code>
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                  <td className="num px-3 py-2.5 text-ink-400">{timeAgo(r.timestamp)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-eyebrow uppercase tracking-wide font-normal">
      {children}
    </th>
  );
}

function StorageCard({ view }: { view: DashboardView }) {
  const sampleUrl = view.storage.sampleRoot
    ? `${view.storage.indexerUrl}/file?root=${view.storage.sampleRoot}`
    : null;
  return (
    <section className="rounded-md border border-ink-700 bg-ink-900/50 p-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-eyebrow uppercase tracking-[0.22em] text-ink-400">
          0g storage
        </h2>
        <TranscriptCountTooltip />
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-caption">
        <dt className="text-ink-500">network</dt>
        <dd className="num text-ink-200">{view.storage.network}</dd>
        <dt className="text-ink-500">indexer</dt>
        <dd>
          <a
            href={view.storage.indexerUrl}
            target="_blank"
            rel="noreferrer"
            className="num text-accent-300 hover:text-accent-200"
          >
            {view.storage.indexerUrl} ↗
          </a>
        </dd>
        <dt className="text-ink-500">transcripts</dt>
        <dd className="num text-ink-200">{view.storage.transcriptCount}</dd>
        <dt className="text-ink-500">total bytes</dt>
        <dd className="num text-ink-200">{formatBytes(view.storage.transcriptBytes)}</dd>
        {sampleUrl && (
          <>
            <dt className="text-ink-500">sample root</dt>
            <dd>
              <a
                href={sampleUrl}
                target="_blank"
                rel="noreferrer"
                className="num text-accent-300 hover:text-accent-200"
              >
                {shortHex(view.storage.sampleRoot ?? "", 10, 8)} ↗
              </a>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

function TranscriptCountTooltip() {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label="data provenance"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-ink-700 bg-ink-800 text-caption text-ink-400 transition-colors hover:border-accent-700 hover:text-accent-300"
      >
        ?
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute right-0 top-7 z-10 w-72 rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-caption text-ink-300 shadow-lg"
        >
          Synod&rsquo;s local index counts transcripts uploaded by the
          designated poster. The chain-authoritative count is{" "}
          <code className="num text-accent-300">
            getLogs(SettlementRecorded)
          </code>{" "}
          — see the Settlements card above.
        </div>
      )}
    </span>
  );
}

function EnsCard({ view }: { view: DashboardView }) {
  const sourceTone =
    view.ens.source === "ens" ? "text-accent-300" : "text-warn-400";
  return (
    <section className="rounded-md border border-ink-700 bg-ink-900/50 p-6">
      <h2 className="mb-3 text-eyebrow uppercase tracking-[0.22em] text-ink-400">
        ens bootloader
      </h2>
      <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-caption">
        <dt className="text-ink-500">parent</dt>
        <dd>
          <a
            href={`https://app.ens.domains/${view.ens.parent}`}
            target="_blank"
            rel="noreferrer"
            className="num text-accent-300 hover:text-accent-200"
          >
            {view.ens.parent} ↗
          </a>
        </dd>
        <dt className="text-ink-500">source</dt>
        <dd className={`num ${sourceTone}`}>{view.ens.source}</dd>
        <dt className="text-ink-500">parent records</dt>
        <dd className="num text-ink-200">{view.ens.parentRecordCount}</dd>
        <dt className="text-ink-500">subnames</dt>
        <dd className="num text-ink-200">{view.ens.subnameCount}</dd>
        <dt className="text-ink-500">threshold</dt>
        <dd className="num text-ink-200">{view.ens.threshold}-of-N</dd>
      </dl>
    </section>
  );
}

function safeHost(u: string): string {
  if (!u) return "—";
  try {
    return new URL(u).host;
  } catch {
    return "—";
  }
}

function ContractStrip({ view }: { view: DashboardView }) {
  return (
    <section className="rounded-md border border-ink-700 bg-ink-900/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-caption">
        <span className="text-ink-500">
          chain id <code className="num text-ink-200">{view.network.chainId}</code>
        </span>
        <span className="text-ink-500">
          registry{" "}
          <code className="num text-ink-200">
            {shortHex(view.network.registryAddress, 10, 8)}
          </code>
        </span>
        <span className="text-ink-500">
          rpc{" "}
          <code className="num text-ink-300">{safeHost(view.network.rpcUrl)}</code>
        </span>
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const [view, setView] = useState<DashboardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTickMs, setLastTickMs] = useState<number>(Date.now());
  const [, forceTick] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/dashboard", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as DashboardView;
        if (!cancelled) {
          setView(j);
          setLastTickMs(Date.now());
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed");
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Re-render once a second so "last updated Xs ago" stays current
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const lastUpdatedSec = Math.floor((Date.now() - lastTickMs) / 1000);

  return (
    <>
      <LiveTicker />
      <NavBar />
      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-12">
        <PageHeader
          eyebrow="Live network statistics"
          title="Synod Dashboard"
          sub="Public, no-auth, auto-updating live read of the Synod protocol. Settlements come straight from on-chain SettlementRecorded events; per-settler agreement is computed against signed votes in 0G transcripts. Refreshes every 30 seconds."
        />

        {error && !view && (
          <div className="rounded-md border border-alert-600 bg-alert-600/15 px-3 py-2 text-body-sm text-alert-400">
            /api/dashboard failed: {error}
          </div>
        )}

        {view ? (
          <>
            <HeroStrip view={view} />
            <ContractStrip view={view} />
            <NetworkHealth view={view} />

            <section>
              <h2 className="mb-3 text-eyebrow uppercase tracking-[0.22em] text-ink-400">
                settler nodes <span className="num text-ink-500">· {view.settlers.length}</span>
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {view.settlers.map((s) => (
                  <SettlerCard key={s.evmAddress || s.name} s={s} />
                ))}
              </div>
            </section>

            <RecentSettlements view={view} />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <StorageCard view={view} />
              <EnsCard view={view} />
            </div>

            <footer className="flex flex-wrap items-center gap-3 border-t border-ink-800/60 pt-4 text-micro text-ink-500">
              <span className="pulse-dot" aria-hidden />
              <span>
                last updated <span className="num text-ink-300">{lastUpdatedSec}s</span> ago ·
                polling /api/dashboard every {POLL_MS / 1000}s
              </span>
              {error && (
                <span className="ml-auto text-alert-400">refresh failed: {error}</span>
              )}
            </footer>
          </>
        ) : (
          <div className="rounded-md border border-dashed border-ink-700 bg-ink-900/30 px-4 py-8 text-center text-body-sm text-ink-500">
            loading dashboard state…
          </div>
        )}
      </main>
      <DeepFooter />
    </>
  );
}
