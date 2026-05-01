/**
 * /gallery — every question Synod has ever settled.
 *
 * Pulls /api/gallery, which composes runtime/transcripts.json + each
 * transcript fetched from 0G Storage + runtime/judgments.json. Each card
 * shows: prompt, outcome, 0G transcript link, ENS judgment subname (if
 * minted), and a deeplink to /verify for the full proof.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { DeepFooter, LiveTicker, NavBar, PageHeader } from "@/lib/site-chrome";

type Item = {
  questionId: string;
  prompt: string;
  outcome: number | null;
  outcomeLabel: string;
  postedAt: number;
  transcript: { root: string; indexerUrl: string; bytes: number };
  judgment: {
    fqn: string;
    owner: string;
    ensAppUrl: string;
    outcome?: string;
    quorum?: string;
  } | null;
};

type GalleryView = {
  count: number;
  items: Item[];
};

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() / 1000 - ts);
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortHex(s: string, head = 8, tail = 6): string {
  if (!s) return "—";
  const stripped = s.startsWith("0x") ? s.slice(2) : s;
  if (stripped.length <= head + tail) return s;
  return `${s.startsWith("0x") ? "0x" : ""}${stripped.slice(0, head)}…${stripped.slice(-tail)}`;
}

function categorize(prompt: string): { tag: string; tone: "accent" | "warn" | "alert" | "ink" } {
  const p = prompt.toLowerCase();
  if (/ignore.*instructions|system override|dan mode|prior instructions/.test(p)) {
    return { tag: "prompt-injection", tone: "alert" };
  }
  if (/strictly better|should.*have|legal personhood|every axis/.test(p)) {
    return { tag: "loaded", tone: "warn" };
  }
  if (/will|by 2026|by december|exceed|reach/.test(p)) {
    return { tag: "prediction", tone: "ink" };
  }
  return { tag: "factual", tone: "accent" };
}

function CategoryPill({ tag, tone }: { tag: string; tone: "accent" | "warn" | "alert" | "ink" }) {
  const styles = {
    accent: "border-accent-700/50 bg-accent-700/10 text-accent-300",
    warn:   "border-warn-500/50 bg-warn-500/10 text-warn-400",
    alert:  "border-alert-600 bg-alert-600/15 text-alert-400",
    ink:    "border-ink-600 bg-ink-800 text-ink-300",
  }[tone];
  return (
    <span className={`rounded border px-2 py-0.5 text-eyebrow uppercase tracking-wide ${styles}`}>
      {tag}
    </span>
  );
}

function Card({ item }: { item: Item }) {
  const cat = categorize(item.prompt);
  return (
    <div className="rounded-md border border-ink-700 bg-ink-900/50 p-4 transition-colors hover:border-ink-600">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <CategoryPill tag={cat.tag} tone={cat.tone} />
        <span className="text-micro text-ink-500">{timeAgo(item.postedAt)}</span>
      </div>
      <p className="mb-3 line-clamp-3 text-body-sm text-ink-100">
        {item.prompt || <span className="text-ink-500">[transcript not yet fetched]</span>}
      </p>
      <div className="mb-3 flex items-baseline gap-3 text-caption">
        <span className="text-ink-500">outcome</span>
        <span className="num text-h3 font-semibold text-ink-50">
          {item.outcomeLabel || (item.outcome !== null ? String(item.outcome) : "—")}
        </span>
        {item.judgment?.quorum && (
          <span className="text-ink-500">
            quorum <span className="num text-ink-300">{item.judgment.quorum}</span>
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 border-t border-ink-700 pt-3 text-caption">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-ink-500">0G transcript</span>
          <a
            href={item.transcript.indexerUrl}
            target="_blank"
            rel="noreferrer"
            className="num truncate text-accent-300 hover:text-accent-200"
          >
            {shortHex(item.transcript.root, 10, 6)} ↗
          </a>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-ink-500">ENS judgment</span>
          {item.judgment ? (
            <a
              href={item.judgment.ensAppUrl}
              target="_blank"
              rel="noreferrer"
              className="num truncate text-accent-300 hover:text-accent-200"
            >
              {item.judgment.fqn} ↗
            </a>
          ) : (
            <span className="text-ink-500">not minted</span>
          )}
        </div>
        <Link
          href={`/verify?qid=${item.questionId.replace(/^0x/, "")}`}
          className="mt-1 inline-flex w-fit items-center gap-1 text-caption text-accent-400 hover:text-accent-300"
        >
          full proof →
        </Link>
      </div>
    </div>
  );
}

export default function GalleryPage() {
  const [view, setView] = useState<GalleryView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/gallery", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (!cancelled) {
          setView((await r.json()) as GalleryView);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed");
      }
    };
    tick();
    const id = setInterval(tick, 15_000);
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
          eyebrow="Gallery"
          title="Every question Synod has settled"
          sub="Each card is a question the swarm independently deliberated, signed, and settled on-chain. The full reasoning chain is permanently anchored on 0G Storage and (when minted) addressable via an ENS judgment subname under synodai.eth. Categories: factual baseline, loaded/biased, prediction, prompt-injection."
        />

      {error && (
        <div className="rounded-md border border-alert-600 bg-alert-600/15 px-3 py-2 text-body-sm text-alert-400">
          /api/gallery: {error}
        </div>
      )}

      {view && (
        <>
          <div className="flex items-baseline gap-4 text-caption text-ink-400">
            <span>
              <span className="num text-h2 font-semibold text-ink-100">{view.count}</span> settled
            </span>
            <span className="text-ink-500">
              auto-refreshing every 15s · click any card to verify the proof
            </span>
          </div>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {view.items.map((it) => (
              <Card key={it.questionId} item={it} />
            ))}
          </section>
        </>
      )}

      </main>
      <DeepFooter />
    </>
  );
}
