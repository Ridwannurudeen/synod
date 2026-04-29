/**
 * Proof Explorer — /verify
 *
 * Public-facing form that takes a question ID and runs the full off-chain
 * settlement-proof verifier on the server. Judges can use this without a
 * terminal. The verifier code is identical to the Python CLI used by
 * smoke tests — same ed25519 sigs, same per-outcome quorum, same weighted
 * score recomputation.
 */

"use client";

import { useState } from "react";
import Link from "next/link";

import type { ProofVerificationView, ProofVoteView } from "@/lib/types";

type ServerView = ProofVerificationView & {
  registryAddress?: string;
  chainId?: number;
  onchain?: {
    outcome: number;
    quorumSize: number;
    weightedScoreScaled: number;
    postedBy: string;
    timestamp: number;
  };
  error?: string;
};

function shortHex(s: string | undefined, head = 8, tail = 8): string {
  if (!s) return "—";
  const stripped = s.startsWith("0x") ? s.slice(2) : s;
  if (stripped.length <= head + tail + 1) return s;
  return `${s.slice(0, head + (s.startsWith("0x") ? 2 : 0))}…${s.slice(-tail)}`;
}

function StatusBanner({ status }: { status: ProofVerificationView["status"] }) {
  if (status === "verified") {
    return (
      <div className="rounded-xl border border-emerald-700 bg-emerald-950/40 px-5 py-4">
        <div className="text-lg font-semibold text-emerald-300">
          ✓ Proof verified
        </div>
        <div className="text-xs text-emerald-200/70">
          Every signature checked against the on-chain registry. Per-outcome
          quorum and weighted score recomputed and matched.
        </div>
      </div>
    );
  }
  if (status === "unavailable") {
    return (
      <div className="rounded-xl border border-zinc-700 bg-zinc-900/40 px-5 py-4">
        <div className="text-lg font-semibold text-zinc-300">⏳ Not settled</div>
        <div className="text-xs text-zinc-500">
          No settlement found on-chain for that question id.
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-rose-700 bg-rose-950/40 px-5 py-4">
      <div className="text-lg font-semibold text-rose-300">✗ Proof invalid</div>
      <div className="text-xs text-rose-200/70">
        At least one check failed. See error list and per-vote rows below.
      </div>
    </div>
  );
}

function VoteRow({ v }: { v: ProofVoteView }) {
  const sigOk = v.signatureValid;
  const regOk = v.registered;
  const allOk = sigOk && regOk;
  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        allOk
          ? "border-emerald-800 bg-emerald-950/30"
          : "border-rose-800 bg-rose-950/30"
      }`}
    >
      <div className="grid grid-cols-[1fr_auto] items-baseline">
        <code className="font-mono text-zinc-200">
          {shortHex(v.pubkey, 12, 8)}
        </code>
        <span className="text-[10px] text-zinc-500">{v.modelTag ?? "—"}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
        <span>
          outcome <span className="text-zinc-200">{v.outcome ?? "—"}</span>
        </span>
        <span>
          confidence <span className="text-zinc-200">{v.confidence?.toFixed(2) ?? "—"}</span>
        </span>
        <span className={sigOk ? "text-emerald-300" : "text-rose-300"}>
          signature {sigOk ? "ok" : "BAD"}
        </span>
        <span className={regOk ? "text-emerald-300" : "text-rose-300"}>
          registered {regOk ? "ok" : "NO"}
        </span>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  const [questionId, setQuestionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<ServerView | null>(null);
  const [topError, setTopError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setTopError(null);
    setView(null);
    try {
      const res = await fetch("/api/verify-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: questionId.trim() }),
      });
      const j = (await res.json()) as ServerView;
      if (!res.ok || j.error) {
        setTopError(j.error || `HTTP ${res.status}`);
      } else {
        setView(j);
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 px-6 py-10 text-zinc-100">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Proof Explorer</h1>
          <Link
            href="/"
            className="text-sm text-emerald-400 hover:text-emerald-300"
          >
            ← deliberation
          </Link>
          <Link
            href="/network"
            className="text-sm text-emerald-400 hover:text-emerald-300"
          >
            mesh
          </Link>
        </div>
        <p className="max-w-3xl text-sm text-zinc-400">
          Paste a question id and the server will recompute the on-chain
          settlement proof: ed25519 signature on each vote, registry
          membership for each signer, per-outcome quorum, and weighted score.
          Same logic as <code className="text-zinc-300">verify_settlement.py</code>.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5"
      >
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">
          Question id (32-byte hex, with or without 0x)
        </label>
        <input
          type="text"
          value={questionId}
          onChange={(e) => setQuestionId(e.target.value)}
          placeholder="0x5f640aef…6589bc"
          required
          minLength={64}
          maxLength={66}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-500"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading || questionId.trim().length < 64}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-700"
          >
            {loading ? "verifying…" : "verify proof"}
          </button>
          <span className="text-xs text-zinc-500">
            CLI equivalent:{" "}
            <code className="text-zinc-300">
              python tools/verify_settlement.py --question-id …
            </code>
          </span>
        </div>
      </form>

      {topError && (
        <div className="rounded-md border border-rose-700 bg-rose-900/30 px-3 py-2 text-sm text-rose-200">
          {topError}
        </div>
      )}

      {view && (
        <section className="flex flex-col gap-4">
          <StatusBanner status={view.status} />

          {view.errors.length > 0 && (
            <div className="rounded-md border border-rose-800 bg-rose-950/40 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-rose-300">
                Errors
              </div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-rose-200">
                {view.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5 text-xs md:grid-cols-3">
            <Field label="question id" value={shortHex(view.questionId, 10, 8)} mono />
            <Field
              label="outcome"
              value={view.onchain ? String(view.onchain.outcome) : "—"}
            />
            <Field
              label="quorum"
              value={
                view.onchain
                  ? `${view.winnerVotes ?? "?"}/${view.onchain.quorumSize}`
                  : "—"
              }
            />
            <Field
              label="weighted score"
              value={
                view.weightedScoreScaled !== undefined
                  ? (view.weightedScoreScaled / 1_000_000).toFixed(2)
                  : "—"
              }
            />
            <Field
              label="registry"
              value={shortHex(view.registryAddress, 10, 8)}
              mono
            />
            <Field label="chain id" value={view.chainId !== undefined ? String(view.chainId) : "—"} />
          </div>

          {view.votes.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-400">
                Votes ({view.votes.length})
              </h2>
              <div className="flex flex-col gap-2">
                {view.votes.map((v, i) => (
                  <VoteRow key={i} v={v} />
                ))}
              </div>
            </section>
          )}
        </section>
      )}

      <footer className="mt-auto pt-6 text-xs text-zinc-600">
        deliberation ·{" "}
        <Link href="/network" className="hover:text-emerald-400">
          mesh
        </Link>{" "}
        ·{" "}
        <Link href="/" className="hover:text-emerald-400">
          home
        </Link>
      </footer>
    </main>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
      <span className={`mt-0.5 ${mono ? "font-mono" : ""} text-zinc-200`}>{value}</span>
    </div>
  );
}
