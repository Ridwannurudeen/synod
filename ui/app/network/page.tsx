/**
 * AXL Mesh Proof Panel
 *
 * Live read-only view of the 3-settler mesh: AXL topology, on-chain
 * registration cross-check, and derived peer edges. Polls /api/network every
 * 5 seconds. Server-side aggregator does the work; this is a thin client.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import type { NetworkView, NodeView } from "@/lib/network";

const POLL_MS = 5_000;
const REFRESH_BUDGET = 1500; // visual fade after each refresh

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
  tone: "green" | "yellow" | "red" | "zinc";
}) {
  const colors = {
    green: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
    yellow: "bg-amber-900/40 text-amber-300 border-amber-700",
    red: "bg-rose-900/40 text-rose-300 border-rose-700",
    zinc: "bg-zinc-800 text-zinc-400 border-zinc-700",
  }[tone];
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${colors}`}>
      {label}
    </span>
  );
}

function nodeTone(n: NodeView): "green" | "yellow" | "red" {
  if (!n.online) return "red";
  if (!n.registered || !n.pubkeyMatchesRegistry) return "yellow";
  return "green";
}

function nodeTitle(n: NodeView): string {
  if (!n.online) return "offline";
  if (!n.registered) return "unregistered";
  if (!n.pubkeyMatchesRegistry) return "key mismatch";
  return "online · registered";
}

function NodeCard({ node }: { node: NodeView }) {
  const tone = nodeTone(node);
  const titleTone = nodeTone(node);
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5 transition hover:border-zinc-700">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Node {node.spec.name}</div>
          <div className="text-xs text-zinc-500">{node.registeredModelTag ?? "—"}</div>
        </div>
        <StatusPill label={nodeTitle(node)} tone={titleTone} />
      </div>

      <div className="mt-4 space-y-2 text-xs">
        <Row label="AXL pubkey">
          <Mono dim={!node.online}>{shortHex(node.pubkey ?? "—")}</Mono>
        </Row>
        <Row label="IPv6 (ygg)">
          <Mono dim>{shortHex(node.ipv6 ?? "—")}</Mono>
        </Row>
        <Row label="EVM address">
          <Mono>{shortHex(node.spec.evmAddress, 10, 8)}</Mono>
        </Row>
        <Row label="AXL API">
          <Mono dim>{node.spec.axlApi}</Mono>
        </Row>
      </div>

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">On-chain</div>
        <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
          <span className="text-zinc-400">registered</span>
          <span className={node.registered ? "text-emerald-300" : "text-rose-300"}>
            {node.registered ? "yes" : "no"}
          </span>
          <span className="text-zinc-400">pubkey match</span>
          <span className={node.pubkeyMatchesRegistry ? "text-emerald-300" : "text-rose-300"}>
            {node.pubkeyMatchesRegistry ? "ok" : node.online ? "mismatch" : "—"}
          </span>
        </div>
      </div>

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">
          Mesh peers ({node.peers.length})
        </div>
        {node.peers.length === 0 ? (
          <div className="mt-1 text-xs text-zinc-500">no peers reported</div>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {node.peers.slice(0, 4).map((p, i) => (
              <li key={i} className="flex items-center gap-2">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    p.up ? "bg-emerald-400" : "bg-rose-400"
                  }`}
                />
                <Mono dim>{p.uri}</Mono>
                <span className="text-zinc-500">{p.inbound ? "in" : "out"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
      <span className="text-zinc-500">{label}</span>
      {children}
    </div>
  );
}

function Mono({ children, dim = false }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <code className={`rounded bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[11px] ${dim ? "text-zinc-400" : "text-zinc-200"}`}>
      {children}
    </code>
  );
}

function MeshDiagram({ view }: { view: NetworkView }) {
  // Simple SVG: 3 dots labelled A/B/C, edges drawn for entries in view.edges.
  // We pin positions geometrically — small triangle.
  const pos: Record<string, { x: number; y: number }> = {
    A: { x: 80, y: 30 },
    B: { x: 30, y: 110 },
    C: { x: 130, y: 110 },
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
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={e.up ? "#10b981" : "#52525b"}
            strokeWidth={e.up ? 1.5 : 1}
            strokeDasharray={e.up ? "" : "3 3"}
          />
        );
      })}
      {view.nodes.map((n) => {
        const p = pos[n.spec.name];
        if (!p) return null;
        const tone = nodeTone(n);
        const fill = tone === "green" ? "#10b981" : tone === "yellow" ? "#f59e0b" : "#f43f5e";
        return (
          <g key={n.spec.name}>
            <circle cx={p.x} cy={p.y} r={9} fill={fill} fillOpacity={0.2} stroke={fill} strokeWidth={1.5} />
            <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={9} fill={fill} fontWeight={600}>
              {n.spec.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Summary({ view, lastTickMs }: { view: NetworkView; lastTickMs: number }) {
  const onlineCount = view.nodes.filter((n) => n.online).length;
  const registeredCount = view.nodes.filter((n) => n.registered && n.pubkeyMatchesRegistry).length;
  const total = view.nodes.length;

  return (
    <section className="grid grid-cols-1 gap-4 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5 md:grid-cols-[1fr_auto]">
      <div className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
          Network state
        </h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-3">
          <Row label="Registry">
            <Mono>{shortHex(view.registryAddress, 10, 8) || "(unknown)"}</Mono>
          </Row>
          <Row label="Chain ID">
            <Mono>{view.chainId ?? "—"}</Mono>
          </Row>
          <Row label="Registered">
            <Mono>
              {view.registeredSettlerCount ?? "—"} settler(s)
            </Mono>
          </Row>
          <Row label="Online">
            <Mono>
              {onlineCount}/{total}
            </Mono>
          </Row>
          <Row label="Mesh edges">
            <Mono>{view.edges.length}</Mono>
          </Row>
          <Row label="Verified">
            <Mono>
              {registeredCount}/{total}
            </Mono>
          </Row>
        </div>
        <p className="pt-2 text-xs text-zinc-500">
          Last refresh {new Date(lastTickMs).toLocaleTimeString()} · polling every {POLL_MS / 1000}s
        </p>
      </div>
      <div className="flex items-center justify-center">
        <MeshDiagram view={view} />
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
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 px-6 py-10 text-zinc-100">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">AXL mesh</h1>
          <Link href="/" className="text-sm text-emerald-400 hover:text-emerald-300">
            ← back to deliberation
          </Link>
        </div>
        <p className="max-w-3xl text-sm text-zinc-400">
          Three independent AXL daemons, each with its own ed25519 identity, connected over an
          encrypted Yggdrasil mesh. Each node is independently registered in{" "}
          <code className="text-zinc-300">SynodRegistry</code> with a distinct EVM address and AXL
          pubkey. This page reads each daemon&apos;s <code>/topology</code> endpoint and
          cross-checks the on-chain registration in real time.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-rose-700 bg-rose-900/30 px-3 py-2 text-sm text-rose-200">
          /api/network failed: {error}
        </div>
      )}

      {view ? (
        <>
          <Summary view={view} lastTickMs={lastTickMs} />
          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-400">
              Settler nodes
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {view.nodes.map((n) => (
                <NodeCard key={n.spec.name} node={n} />
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-400">
              What this proves
            </h2>
            <ul className="space-y-2 text-sm text-zinc-300">
              <li>
                <span className="text-emerald-400">●</span> Each green node is a real AXL daemon
                serving its own pubkey from <code>/topology</code>, independently routable over
                the encrypted mesh.
              </li>
              <li>
                <span className="text-emerald-400">●</span> Each registered settler holds a
                distinct EVM address whose recorded <code>axlPubKey</code> in{" "}
                <code>SynodRegistry</code> matches the live AXL pubkey. A pubkey mismatch would
                turn the card amber and break consensus.
              </li>
              <li>
                <span className="text-emerald-400">●</span> The mesh-edges count above is non-zero
                only if at least two daemons report active peer connections — i.e. the
                deliberation network is real, not a stub.
              </li>
            </ul>
          </section>
        </>
      ) : (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-500">
          loading network state…
        </div>
      )}

      <footer className="mt-auto pt-6 text-xs text-zinc-600">
        polling /api/network ·{" "}
        <Link href="/" className="text-zinc-500 underline-offset-2 hover:text-emerald-400 hover:underline">
          deliberation viewer
        </Link>
      </footer>
    </main>
  );
}
