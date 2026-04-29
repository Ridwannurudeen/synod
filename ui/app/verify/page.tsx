/**
 * Proof Explorer — /verify
 *
 * Dashboard archetype with display-xl PASS/FAIL signature: paste a question
 * id, server reads SynodRegistry.getSettlement, runs the same verifier as
 * the Python CLI, returns ProofVerificationView.
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

function SignatureMoment({ status, errorCount }: { status: ProofVerificationView["status"]; errorCount: number }) {
  if (status === "verified") {
    return (
      <section className="flex flex-col items-center gap-3 rounded-md border border-accent-700 bg-accent-700/10 px-6 py-10 text-center">
        <span className="text-eyebrow uppercase tracking-wide text-accent-400">proof status</span>
        <span className="halo-accent text-display font-semibold tracking-tight text-accent-400 md:text-display-xl">
          verified
        </span>
        <span className="max-w-md text-body-sm text-accent-300/80">
          every signature checked against the on-chain registry · per-outcome quorum
          and weighted score recomputed from raw payload bytes
        </span>
      </section>
    );
  }
  if (status === "unavailable") {
    return (
      <section className="flex flex-col items-center gap-3 rounded-md border border-ink-600 bg-ink-900/40 px-6 py-10 text-center">
        <span className="text-eyebrow uppercase tracking-wide text-ink-400">proof status</span>
        <span className="text-display font-semibold tracking-tight text-ink-300 md:text-display">
          not settled
        </span>
        <span className="max-w-md text-body-sm text-ink-500">
          no settlement found on-chain for that question id at the configured registry
        </span>
      </section>
    );
  }
  return (
    <section className="flex flex-col items-center gap-3 rounded-md border border-alert-600 bg-alert-600/10 px-6 py-10 text-center">
      <span className="text-eyebrow uppercase tracking-wide text-alert-400">proof status</span>
      <span className="halo-alert text-display font-semibold tracking-tight text-alert-400 md:text-display-xl">
        invalid
      </span>
      <span className="max-w-md text-body-sm text-alert-400/80">
        {errorCount === 1 ? "1 check" : `${errorCount} checks`} failed — see error list and per-vote rows below
      </span>
    </section>
  );
}

function VoteRow({ v }: { v: ProofVoteView }) {
  const sigOk = v.signatureValid;
  const regOk = v.registered;
  const allOk = sigOk && regOk;
  const tone = allOk ? "border-accent-700 bg-accent-700/8" : "border-alert-600 bg-alert-600/10";
  return (
    <div className={`rounded-md border ${tone} px-4 py-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <code className="num text-body-sm text-ink-100">
          {shortHex(v.pubkey, 12, 8)}
        </code>
        <span className="text-eyebrow uppercase tracking-wide text-ink-500">{v.modelTag ?? "—"}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-caption">
        <span className="text-ink-500">
          outcome <span className="num text-ink-100">{v.outcome ?? "—"}</span>
        </span>
        <span className="text-ink-500">
          confidence <span className="num text-ink-100">{v.confidence?.toFixed(2) ?? "—"}</span>
        </span>
        <span className={`flex items-center gap-1.5 ${sigOk ? "text-accent-400" : "text-alert-400"}`}>
          <span className={`h-1.5 w-1.5 rounded-md ${sigOk ? "bg-accent-500" : "bg-alert-500"}`} />
          signature {sigOk ? "ok" : "BAD"}
        </span>
        <span className={`flex items-center gap-1.5 ${regOk ? "text-accent-400" : "text-alert-400"}`}>
          <span className={`h-1.5 w-1.5 rounded-md ${regOk ? "bg-accent-500" : "bg-alert-500"}`} />
          registered {regOk ? "ok" : "NO"}
        </span>
      </div>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-eyebrow uppercase tracking-wide text-ink-500">{label}</span>
      <span className={`${mono ? "num" : ""} text-body text-ink-100`}>{value}</span>
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
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-h1 font-semibold tracking-tight text-ink-50">Proof explorer</h1>
          <span className="text-body-sm text-ink-400">verify any settlement independently</span>
          <Link href="/" className="ml-auto rounded-md border border-ink-700 px-3 py-1 text-caption text-ink-300 hover:border-accent-700 hover:text-accent-400 transition-colors">
            ← deliberation
          </Link>
        </div>
        <p className="max-w-3xl text-body-sm text-ink-400">
          Paste a question id and the server recomputes the on-chain settlement proof:
          ed25519 signature on each vote, registry membership for each signer, per-outcome quorum, and
          weighted score. Same logic as
          <code className="num mx-1 rounded bg-ink-800 px-1.5 py-0.5 text-ink-200">verify_settlement.py</code>.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-md border border-ink-700 bg-ink-900/50 p-5">
        <label className="text-eyebrow uppercase tracking-wide text-ink-400">
          question id <span className="text-ink-500">(32-byte hex, with or without 0x)</span>
        </label>
        <input
          type="text"
          value={questionId}
          onChange={(e) => setQuestionId(e.target.value)}
          placeholder="0x5f640aef…6589bc"
          required
          minLength={64}
          maxLength={66}
          className="num rounded-md border border-ink-700 bg-ink-950 px-3 py-2.5 text-body text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-500"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={loading || questionId.trim().length < 64}
            className="rounded-md bg-accent-500 px-4 py-2 text-body-sm font-medium text-ink-950 transition-colors hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
          >
            {loading ? "verifying…" : "verify proof"}
          </button>
          <span className="text-caption text-ink-500">
            CLI equivalent:{" "}
            <code className="num text-ink-300">python tools/verify_settlement.py --question-id …</code>
          </span>
        </div>
      </form>

      {topError && (
        <div className="rounded-md border border-alert-600 bg-alert-600/15 px-3 py-2 text-body-sm text-alert-400">
          {topError}
        </div>
      )}

      {view && (
        <section className="flex flex-col gap-5">
          <SignatureMoment status={view.status} errorCount={view.errors.length} />

          {view.errors.length > 0 && (
            <div className="rounded-md border border-alert-600 bg-alert-600/10 px-4 py-3">
              <div className="text-eyebrow uppercase tracking-wide text-alert-400">errors</div>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-caption text-alert-400">
                {view.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border border-ink-700 bg-ink-900/50 p-5 md:grid-cols-3">
            <Field label="question id" value={shortHex(view.questionId, 10, 8)} mono />
            <Field label="outcome" value={view.onchain ? String(view.onchain.outcome) : "—"} mono />
            <Field
              label="quorum"
              value={view.onchain ? `${view.winnerVotes ?? "?"} / ${view.onchain.quorumSize}` : "—"}
              mono
            />
            <Field
              label="weighted score"
              value={view.weightedScoreScaled !== undefined ? (view.weightedScoreScaled / 1_000_000).toFixed(2) : "—"}
              mono
            />
            <Field label="registry" value={shortHex(view.registryAddress, 10, 8)} mono />
            <Field label="chain id" value={view.chainId !== undefined ? String(view.chainId) : "—"} mono />
          </div>

          {view.votes.length > 0 && (
            <section>
              <h2 className="mb-2 text-eyebrow uppercase tracking-wide text-ink-400">
                votes <span className="num text-ink-300">{view.votes.length}</span>
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

      <footer className="mt-auto pt-6 text-micro text-ink-500">
        <Link href="/" className="hover:text-accent-400">deliberation</Link> ·{" "}
        <Link href="/network" className="hover:text-accent-400">mesh</Link>
      </footer>
    </main>
  );
}
