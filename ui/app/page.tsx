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

function ProtocolStatsStrip() {
  const [stats, setStats] = useState<ProtocolStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/stats", { cache: "no-store" });
        if (r.ok && !cancelled) setStats((await r.json()) as ProtocolStats);
      } catch {
        // ignore — homepage still renders without counters
      }
    };
    tick();
    const id = setInterval(tick, 12_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-caption">
      <span className="flex items-center gap-1.5">
        <span className="text-ink-500">questions settled</span>
        <span className="num font-semibold text-ink-100">{stats?.questionsSettled ?? "—"}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-ink-500">judgments minted</span>
        <span className="num font-semibold text-ink-100">{stats?.judgmentsMinted ?? "—"}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-ink-500">transcripts on 0G</span>
        <span className="num font-semibold text-ink-100">
          {stats ? `${stats.transcriptsKB} KB` : "—"}
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-ink-500">settlers registered</span>
        <span className="num font-semibold text-ink-100">
          {stats?.registeredSettlerCount ?? "—"}
        </span>
      </span>
      {stats && (
        <span className="ml-auto text-micro text-ink-500">
          source: <code className="num text-ink-300">{stats.ensParent}</code>
        </span>
      )}
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

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-h1 font-semibold tracking-tight text-ink-50">Synod</h1>
          <span className="text-body-sm text-ink-400">decentralized AI settlement for Delphi</span>
          <a
            href="/gallery"
            className="ml-auto rounded-md border border-ink-700 px-3 py-1 text-caption text-ink-300 transition-colors hover:border-accent-700 hover:text-accent-400"
          >
            Gallery →
          </a>
          <a
            href="/network"
            className="rounded-md border border-ink-700 px-3 py-1 text-caption text-ink-300 transition-colors hover:border-accent-700 hover:text-accent-400"
          >
            AXL mesh →
          </a>
          <a
            href="/verify"
            className="rounded-md border border-ink-700 px-3 py-1 text-caption text-ink-300 transition-colors hover:border-accent-700 hover:text-accent-400"
          >
            Verify proof →
          </a>
        </div>
        <p className="max-w-3xl text-body-sm text-ink-400">
          Heterogeneous AI models running on independent machines coordinate over Gensyn AXL,
          sign their settlement votes with ed25519 identities, and post the quorum-signed result
          to <code className="num rounded bg-ink-800 px-1.5 py-0.5 text-ink-200">SynodRegistry</code> on Gensyn L2.
        </p>
        <ProtocolStatsStrip />
      </header>

      {/* SIGNATURE MOMENT — display-xl outcome with halo when consensus reached */}
      {consensusReached && (
        <section className="rounded-md border border-accent-700 bg-accent-700/10 px-6 py-8">
          <div className="flex flex-col items-center gap-2 md:flex-row md:items-center md:justify-between md:gap-12">
            <div className="flex flex-col items-center md:items-start">
              <span className="text-eyebrow uppercase tracking-wide text-accent-400">consensus outcome</span>
              <span className="halo-accent num text-display font-semibold tracking-tight text-accent-400 md:text-display-xl">
                {consensus!.outcome}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-x-8 gap-y-1 text-center md:text-left">
              <div className="flex flex-col">
                <span className="text-eyebrow uppercase tracking-wide text-accent-400/80">quorum</span>
                <span className="num text-h2 font-semibold text-ink-100">{consensus!.quorumSize ?? "—"}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-eyebrow uppercase tracking-wide text-accent-400/80">weighted</span>
                <span className="num text-h2 font-semibold text-ink-100">
                  {consensus!.weightedScore?.toFixed(2) ?? "—"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-eyebrow uppercase tracking-wide text-accent-400/80">settlers</span>
                <span className="num text-h2 font-semibold text-ink-100">{settlers.length}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* INJECT FORM */}
      <section className="rounded-md border border-ink-700 bg-ink-900/50 p-5">
        <h2 className="mb-3 text-eyebrow uppercase tracking-wide text-ink-400">
          submit a market resolution prompt
        </h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <textarea
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            rows={2}
            placeholder="Will protocol X reach $100M TVL by end of year?"
            className="w-full resize-none rounded-md border border-ink-700 bg-ink-950 px-3 py-2.5 text-body text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-500"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-caption text-ink-400">
              outcomes:
              <input
                value={form.outcomes}
                onChange={(e) => setForm({ ...form, outcomes: e.target.value })}
                className="num w-32 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-ink-100 outline-none focus:border-accent-500"
              />
            </label>
            <label className="flex items-center gap-2 text-caption text-ink-400">
              deadline (s):
              <input
                type="number"
                min={30}
                max={3600}
                value={form.deadlineSecs}
                onChange={(e) => setForm({ ...form, deadlineSecs: Number(e.target.value) || 180 })}
                className="num w-24 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-ink-100 outline-none focus:border-accent-500"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="ml-auto rounded-md bg-accent-500 px-4 py-2 text-body-sm font-medium text-ink-950 transition-colors hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
            >
              {submitting ? "injecting…" : "inject question"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 text-caption">
            <span className="text-ink-500">try:</span>
            {SAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setForm({ ...form, prompt: p })}
                className="rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1 text-ink-400 transition-colors hover:border-accent-700 hover:text-accent-400"
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
      </section>

      {/* ACTIVE QUESTION */}
      {consensus && (
        <section className="rounded-md border border-ink-700 bg-ink-900/50 p-5">
          <h2 className="mb-2 text-eyebrow uppercase tracking-wide text-ink-400">active question</h2>
          <p className="mb-3 text-body text-ink-100">{consensus.prompt || "—"}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-caption text-ink-400">
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
        </section>
      )}

      {/* SETTLER NODES */}
      <section>
        <h2 className="mb-3 text-eyebrow uppercase tracking-wide text-ink-400">settler nodes</h2>
        {settlers.length === 0 ? (
          <p className="rounded-md border border-dashed border-ink-700 bg-ink-900/30 px-4 py-6 text-body-sm text-ink-500">
            No settler activity yet. Inject a question to start a deliberation.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {settlers.map((s) => (
              <div key={s.pubkey} className={`rounded-md border p-4 transition ${STATUS_TO_TONE[s.status]}`}>
                <div className="flex items-baseline justify-between">
                  <h3 className="num text-body-sm font-medium text-ink-100">{shortHex(s.pubkey, 8, 6)}</h3>
                  <span
                    className={`text-eyebrow uppercase tracking-wide ${
                      s.online ? "text-accent-400" : "text-ink-500"
                    }`}
                  >
                    {s.online ? "online" : "offline"}
                  </span>
                </div>
                <p className="mt-1 text-caption text-ink-400">{s.modelTag ?? "model: tbd"}</p>
                <p className="mt-3 text-eyebrow uppercase tracking-wide text-current">
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
        )}
      </section>

      {/* ON-CHAIN RECEIPT */}
      {onchain.postedTxHash && (
        <section className="rounded-md border border-warn-500/40 bg-warn-500/5 p-5">
          <h2 className="mb-3 text-eyebrow uppercase tracking-wide text-warn-400">recorded on-chain</h2>
          <div className="grid gap-3 text-body-sm sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-eyebrow uppercase tracking-wide text-ink-500">tx hash</span>
              <div className="flex items-center gap-2">
                <code className="num text-ink-100">{shortHex(onchain.postedTxHash, 12, 10)}</code>
                {txUrl && (
                  <a href={txUrl} target="_blank" rel="noreferrer" className="text-caption text-accent-400 underline-offset-2 hover:underline">
                    view ↗
                  </a>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-eyebrow uppercase tracking-wide text-ink-500">posted by</span>
              <code className="num text-ink-100">{shortHex(onchain.postedBy)}</code>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-eyebrow uppercase tracking-wide text-ink-500">registry</span>
              <code className="num text-ink-100">{shortHex(onchain.registryAddress)}</code>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-eyebrow uppercase tracking-wide text-ink-500">chain id</span>
              <code className="num text-ink-100">{onchain.chainId ?? "—"}</code>
            </div>
          </div>
          {onchain.proof && (
            <div className="mt-5 border-t border-ink-700 pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-eyebrow uppercase tracking-wide text-ink-400">proof verification</h3>
                <span
                  className={`rounded-md border px-2 py-0.5 text-eyebrow uppercase tracking-wide ${
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
        </section>
      )}

      <footer className="mt-auto pt-6 text-micro text-ink-500">
        polling /api/state · {state ? "connected" : "starting"}
        {activeQuestionId && (
          <>
            {" · "}
            q=<code className="num">{shortHex(activeQuestionId, 6, 4)}</code>
          </>
        )}
      </footer>
    </main>
  );
}
