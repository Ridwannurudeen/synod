/**
 * AXL Mesh Proof Panel
 *
 * Terminal-archetype: live read of every AXL daemon's /topology endpoint
 * + on-chain registration cross-check + mesh-edge graph. Polls /api/network
 * every 5s. Signature moment: pulsing live dots + animated mesh-edge count.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import type { NetworkView, NodeView } from "@/lib/network";
import { DeepFooter, LiveTicker, NavBar, PageHeader } from "@/lib/site-chrome";

const POLL_MS = 5_000;

function shortHex(s: string | undefined, head = 8, tail = 8): string {
  if (!s) return "";
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "accent" | "warn" | "alert" | "ink";
}) {
  const styles = {
    accent: "border-accent-700 bg-accent-700/15 text-accent-300",
    warn:   "border-warn-500/60 bg-warn-500/10 text-warn-400",
    alert:  "border-alert-600 bg-alert-600/15 text-alert-400",
    ink:    "border-ink-600 bg-ink-800 text-ink-300",
  }[tone];
  return (
    <span className={`rounded-md border px-2 py-0.5 text-eyebrow uppercase tracking-wide ${styles}`}>
      {label}
    </span>
  );
}

function nodeTone(n: NodeView): "accent" | "warn" | "alert" {
  if (!n.online) return "alert";
  if (!n.registered || !n.pubkeyMatchesRegistry) return "warn";
  return "accent";
}

function nodeStatusLabel(n: NodeView): string {
  if (!n.online) return "offline";
  if (!n.registered) return "unregistered";
  if (!n.pubkeyMatchesRegistry) return "key mismatch";
  return "online";
}

function PulseDot({ tone }: { tone: "accent" | "warn" | "alert" }) {
  const cls = tone === "accent" ? "" : tone === "warn" ? "pulse-dot-warn" : "pulse-dot-alert";
  return <span className={`pulse-dot ${cls}`} aria-hidden />;
}

function NodeCard({ node }: { node: NodeView }) {
  const tone = nodeTone(node);
  return (
    <div className="rounded-md border border-ink-700 bg-ink-900/60 p-5 transition-colors hover:border-ink-600">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-h2 font-semibold tracking-tight text-ink-100">{node.spec.name}</span>
            <PulseDot tone={tone} />
          </div>
          <div className="text-micro text-ink-400">
            {node.spec.ensRole ?? node.registeredModelTag ?? "—"}
          </div>
        </div>
        <StatusPill label={nodeStatusLabel(node)} tone={tone} />
      </div>

      {node.spec.ensFqn && (
        <div className="mt-3 flex items-center gap-2 rounded border border-accent-700/40 bg-accent-700/8 px-2 py-1.5">
          <span className="text-eyebrow uppercase tracking-wide text-accent-400">ens</span>
          <code className="num text-caption text-accent-300">{node.spec.ensFqn}</code>
          {node.pubkeyMatchesEns === true && (
            <span className="ml-auto text-caption text-accent-400" title="live AXL pubkey matches synod.pubkey text record">✓ pubkey</span>
          )}
          {node.pubkeyMatchesEns === false && (
            <span className="ml-auto text-caption text-alert-400" title="live AXL pubkey ≠ ENS synod.pubkey">✗ pubkey</span>
          )}
        </div>
      )}

      <dl className="mt-5 grid grid-cols-[5.5rem_1fr] gap-y-1.5 text-caption">
        <Field k="pubkey" v={shortHex(node.pubkey ?? "—")} mono />
        <Field k="ipv6" v={shortHex(node.ipv6 ?? "—")} mono dim />
        <Field k="evm" v={shortHex(node.spec.evmAddress, 10, 8)} mono />
        <Field k="axl api" v={node.spec.axlApi} mono dim />
      </dl>

      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-ink-700 pt-4 text-caption">
        <span className="text-ink-400">on-chain</span>
        <span className={node.registered ? "text-accent-400" : "text-alert-400"}>
          {node.registered ? "registered" : "not registered"}
        </span>
        <span className="text-ink-400">key match</span>
        <span className={node.pubkeyMatchesRegistry ? "text-accent-400" : "text-alert-400"}>
          {node.pubkeyMatchesRegistry ? "ok" : node.online ? "mismatch" : "—"}
        </span>
      </div>

      <div className="mt-5 border-t border-ink-700 pt-4">
        <div className="text-eyebrow uppercase tracking-wide text-ink-400">
          mesh peers <span className="num text-ink-300">{node.peers.length}</span>
        </div>
        {node.peers.length === 0 ? (
          <div className="mt-1 text-caption text-ink-500">no peers reported</div>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-caption">
            {node.peers.slice(0, 4).map((p, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={`inline-block h-1.5 w-1.5 rounded-md ${p.up ? "bg-accent-500" : "bg-alert-500"}`} />
                <code className="num text-ink-300">{p.uri}</code>
                <span className="text-ink-500">{p.inbound ? "in" : "out"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ k, v, mono = false, dim = false }: { k: string; v: string; mono?: boolean; dim?: boolean }) {
  return (
    <>
      <dt className="text-ink-500">{k}</dt>
      <dd className={`${mono ? "num" : ""} ${dim ? "text-ink-400" : "text-ink-200"}`}>{v}</dd>
    </>
  );
}

function MeshDiagram({ view }: { view: NetworkView }) {
  const pos: Record<string, { x: number; y: number }> = {
    A: { x: 80, y: 28 },
    B: { x: 28, y: 112 },
    C: { x: 132, y: 112 },
  };
  return (
    <svg viewBox="0 0 160 140" className="h-32 w-40">
      {view.edges.map((e, i) => {
        const a = pos[e.from];
        const b = pos[e.to];
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={e.up ? "rgb(0, 229, 160)" : "rgb(68, 78, 97)"}
            strokeWidth={e.up ? 1.5 : 1}
            strokeDasharray={e.up ? "" : "3 3"}
            style={e.up ? { filter: "drop-shadow(0 0 6px rgba(0,229,160,0.6))" } : undefined}
          />
        );
      })}
      {view.nodes.map((n) => {
        const p = pos[n.spec.name];
        if (!p) return null;
        const tone = nodeTone(n);
        const fill = tone === "accent" ? "rgb(0, 229, 160)" : tone === "warn" ? "rgb(222, 142, 18)" : "rgb(255, 90, 107)";
        return (
          <g key={n.spec.name}>
            <circle cx={p.x} cy={p.y} r={11} fill={fill} fillOpacity={0.15} stroke={fill} strokeWidth={1.5} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11} fill={fill} fontWeight={600} fontFamily="var(--font-geist-mono)">
              {n.spec.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function StatTile({
  label,
  value,
  flashKey,
  tone = "default",
}: {
  label: string;
  value: string | number;
  flashKey?: string | number;
  tone?: "default" | "accent" | "alert";
}) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (flashKey === undefined) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashKey]);
  const valueClass =
    tone === "accent" ? "text-accent-400" :
    tone === "alert" ? "text-alert-400" :
    "text-ink-100";
  return (
    <div className="flex flex-col gap-1 rounded-md border border-ink-700 bg-ink-900/40 px-4 py-3">
      <span className="text-eyebrow uppercase tracking-wide text-ink-500">{label}</span>
      <span className={`num text-h2 font-semibold ${valueClass} ${flash ? "flash-on-update rounded" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function Summary({ view, lastTickMs }: { view: NetworkView; lastTickMs: number }) {
  const onlineCount = view.nodes.filter((n) => n.online).length;
  const verifiedCount = view.nodes.filter((n) => n.registered && n.pubkeyMatchesRegistry).length;
  const total = view.nodes.length;
  const ensSourced = view.configSource === "ens";

  return (
    <section className="rounded-md border border-ink-700 bg-ink-900/50 p-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <PulseDot tone="accent" />
          <span className="text-eyebrow uppercase tracking-wide text-ink-400">network state · live</span>
          {ensSourced && view.ensParent && (
            <span
              className="ml-auto flex items-center gap-1.5 rounded-md border border-accent-700/40 bg-accent-700/10 px-2.5 py-1 text-caption text-accent-300"
              title={`Registry, RPC, chain-id, threshold and the settler list were resolved from on-chain ENS records on ${view.ensParent}. Removing the ENS subnames or changing the registry text record swings this UI to a different deployment.`}
            >
              <span className="text-accent-400">●</span>
              source: <code className="num text-accent-200">{view.ensParent}</code>
              {view.ensSubnameCount !== undefined && (
                <span className="text-ink-500">· {view.ensSubnameCount} subnames</span>
              )}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatTile label="online" value={`${onlineCount} / ${total}`} flashKey={onlineCount} tone={onlineCount === total ? "accent" : "alert"} />
          <StatTile label="verified" value={`${verifiedCount} / ${total}`} flashKey={verifiedCount} tone={verifiedCount === total ? "accent" : "alert"} />
          <StatTile label="mesh edges" value={view.edges.length} flashKey={view.edges.length} tone={view.edges.length > 0 ? "accent" : "default"} />
          <StatTile label="settlers" value={view.registeredSettlerCount ?? "—"} />
          <StatTile label="chain id" value={view.chainId ?? "—"} />
          <div className="flex flex-col gap-1 rounded-md border border-ink-700 bg-ink-900/40 px-4 py-3">
            <span className="text-eyebrow uppercase tracking-wide text-ink-500">registry</span>
            <code className="num text-body-sm text-ink-200">{shortHex(view.registryAddress, 10, 8) || "—"}</code>
          </div>
        </div>

        <p className="text-micro text-ink-500">
          last refresh {new Date(lastTickMs).toLocaleTimeString()} · polling /api/network every {POLL_MS / 1000}s
        </p>
      </div>
    </section>
  );
}

export default function NetworkPage() {
  const [view, setView] = useState<NetworkView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTickMs, setLastTickMs] = useState<number>(Date.now());

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/network", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as NetworkView;
        if (!cancelled) {
          setView(j);
          setLastTickMs(Date.now());
          setError(null);
        }
      } catch (e: unknown) {
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

  return (
    <>
      <LiveTicker />
      <NavBar />
      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-12">
        <PageHeader
          eyebrow="AXL mesh"
          title="Cross-machine settler network"
          sub="Independent AXL daemons, each with its own ed25519 identity, connected over an encrypted Yggdrasil mesh across two physical machines (Frankfurt + Toronto). Each node is independently registered in SynodRegistry with a distinct EVM address. This page reads each daemon's /topology endpoint and cross-checks ENS + on-chain + live AXL state in real time."
        />

      {error && (
        <div className="rounded-md border border-alert-600 bg-alert-600/15 px-3 py-2 text-body-sm text-alert-400">
          /api/network failed: {error}
        </div>
      )}

      {view ? (
        <>
          {/* SIGNATURE MOMENT — display-xl ratio of online+verified nodes with halo */}
          <section className="rounded-md border border-accent-700 bg-accent-700/8 px-6 py-8">
            <div className="flex flex-col items-center gap-2 md:flex-row md:items-center md:justify-between md:gap-12">
              <div className="flex flex-col items-center md:items-start">
                <span className="text-eyebrow uppercase tracking-wide text-accent-400">network is live</span>
                {(() => {
                  const onlineCount = view.nodes.filter((n) => n.online).length;
                  const verifiedCount = view.nodes.filter((n) => n.registered && n.pubkeyMatchesRegistry).length;
                  const total = view.nodes.length;
                  const allGood = onlineCount === total && verifiedCount === total;
                  return (
                    <span className={`num text-display font-semibold tracking-tight md:text-display-xl ${allGood ? "halo-accent text-accent-400" : "text-ink-100"}`}>
                      {verifiedCount} <span className="text-ink-400">/</span> {total}
                    </span>
                  );
                })()}
                <span className="text-body-sm text-accent-300/80">
                  settlers verified on-chain, meshed over Gensyn AXL
                </span>
              </div>
              <div className="flex items-center justify-center">
                <MeshDiagram view={view} />
              </div>
            </div>
          </section>

          <Summary view={view} lastTickMs={lastTickMs} />
          <section>
            <h2 className="mb-3 text-eyebrow uppercase tracking-wide text-ink-400">Settler nodes</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {view.nodes.map((n) => (
                <NodeCard key={n.spec.name} node={n} />
              ))}
            </div>
          </section>

          <section className="rounded-md border border-ink-700 bg-ink-900/50 p-5">
            <h2 className="mb-3 text-eyebrow uppercase tracking-wide text-ink-400">What this proves</h2>
            <ul className="space-y-2 text-body-sm text-ink-300">
              <li className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-md bg-accent-500" />
                Each green node is a real AXL daemon serving its own pubkey from
                <code className="num mx-1 rounded bg-ink-800 px-1 text-ink-200">/topology</code>,
                independently routable over the encrypted mesh.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-md bg-accent-500" />
                Each registered settler holds a distinct EVM address whose recorded
                <code className="num mx-1 rounded bg-ink-800 px-1 text-ink-200">axlPubKey</code>
                in <code className="num mx-1 rounded bg-ink-800 px-1 text-ink-200">SynodRegistry</code>
                matches the live AXL pubkey. A pubkey mismatch turns the card amber and breaks consensus.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-md bg-accent-500" />
                The mesh-edges count above is non-zero only if at least two daemons report active peer
                connections — i.e. the deliberation network is real, not a stub.
              </li>
            </ul>
          </section>
        </>
      ) : (
        <div className="rounded-md border border-dashed border-ink-700 bg-ink-900/30 px-4 py-8 text-center text-body-sm text-ink-500">
          loading network state…
        </div>
      )}

      </main>
      <DeepFooter />
    </>
  );
}
