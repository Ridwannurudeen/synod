"use client";

/**
 * Synod live deliberation viewer.
 *
 * Polls /api/state every 500ms and renders:
 *   - the active question form
 *   - one card per settler with status, vote, confidence
 *   - the off-chain consensus banner once quorum is reached
 *   - the on-chain receipt panel when a tx is confirmed
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  DeliberationState,
  InjectQuestionResponse,
  SettlerView,
} from "@/lib/types";

const STATUS_TO_LABEL: Record<SettlerView["status"], string> = {
  idle: "Idle",
  received: "Question received",
  inferring: "Running inference",
  voted: "Vote signed",
  consensus: "Consensus reached",
  posted: "Posted on-chain",
};

const STATUS_TO_TONE: Record<SettlerView["status"], string> = {
  idle: "border-zinc-700 bg-zinc-900/60 text-zinc-400",
  received: "border-sky-700/60 bg-sky-950/60 text-sky-300",
  inferring: "border-violet-700/60 bg-violet-950/60 text-violet-300 animate-pulse",
  voted: "border-emerald-700/60 bg-emerald-950/60 text-emerald-300",
  consensus: "border-emerald-500 bg-emerald-900/60 text-emerald-200",
  posted: "border-amber-500 bg-amber-900/40 text-amber-200",
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

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 px-6 py-10 text-zinc-100">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Synod</h1>
          <span className="text-sm text-zinc-500">
            decentralized AI settlement for Delphi
          </span>
        </div>
        <p className="max-w-3xl text-sm text-zinc-400">
          Heterogeneous AI models running on independent machines coordinate over
          Gensyn AXL, sign their settlement votes with ed25519 identities, and
          post the quorum-signed result to{" "}
          <code className="text-zinc-300">SynodRegistry</code> on Gensyn L2.
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-400">
          Submit a market resolution prompt
        </h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <textarea
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            rows={2}
            placeholder="Will protocol X reach $100M TVL by end of year?"
            className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-500"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              outcomes:
              <input
                value={form.outcomes}
                onChange={(e) => setForm({ ...form, outcomes: e.target.value })}
                className="w-32 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 outline-none focus:border-emerald-500"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              deadline (s):
              <input
                type="number"
                min={30}
                max={3600}
                value={form.deadlineSecs}
                onChange={(e) =>
                  setForm({ ...form, deadlineSecs: Number(e.target.value) || 180 })
                }
                className="w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 outline-none focus:border-emerald-500"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="ml-auto rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-700"
            >
              {submitting ? "Injecting…" : "Inject question"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="text-zinc-500">try:</span>
            {SAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setForm({ ...form, prompt: p })}
                className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-400 transition hover:border-emerald-700 hover:text-emerald-300"
              >
                {p.length > 60 ? `${p.slice(0, 60)}…` : p}
              </button>
            ))}
          </div>
          {submitError && (
            <p className="rounded-md border border-rose-700 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {submitError}
            </p>
          )}
        </form>
      </section>

      {consensus && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-400">
            Active question
          </h2>
          <p className="mb-3 text-base text-zinc-100">{consensus.prompt || "—"}</p>
          <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
            <span>
              question_id:{" "}
              <code className="text-zinc-300">
                {shortHex(consensus.questionId, 8, 6)}
              </code>
            </span>
            <span>
              outcomes:{" "}
              <code className="text-zinc-300">{consensus.outcomes.join(", ")}</code>
            </span>
            {consensus.quorumSize !== undefined && (
              <span>
                quorum so far:{" "}
                <code className="text-zinc-300">{consensus.quorumSize}</code>
              </span>
            )}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-400">
          Settler nodes
        </h2>
        {settlers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-6 text-sm text-zinc-500">
            No settler activity yet. Inject a question to start a deliberation.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {settlers.map((s) => (
              <div
                key={s.pubkey}
                className={`rounded-xl border p-4 transition ${STATUS_TO_TONE[s.status]}`}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="font-mono text-sm font-medium text-zinc-200">
                    {shortHex(s.pubkey, 8, 6)}
                  </h3>
                  <span
                    className={`text-[10px] font-medium uppercase tracking-wider ${
                      s.online ? "text-emerald-400" : "text-zinc-500"
                    }`}
                  >
                    {s.online ? "online" : "offline"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-400">
                  {s.modelTag ?? "model: tbd"}
                </p>
                <p className="mt-3 text-xs uppercase tracking-wide text-current">
                  {STATUS_TO_LABEL[s.status]}
                </p>
                {s.votedOutcome !== undefined && (
                  <div className="mt-2 flex items-baseline gap-3 text-sm">
                    <span className="text-zinc-300">
                      outcome:{" "}
                      <strong className="text-zinc-100">{s.votedOutcome}</strong>
                    </span>
                    {s.votedConfidence !== undefined && (
                      <span className="text-zinc-400">
                        confidence: <code>{s.votedConfidence.toFixed(3)}</code>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {consensus?.outcome !== undefined && (
        <section className="rounded-2xl border border-emerald-700/60 bg-emerald-950/40 p-5">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-emerald-300">
            Consensus reached
          </h2>
          <div className="flex flex-wrap items-baseline gap-6">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-emerald-400">
                outcome
              </div>
              <div className="font-mono text-3xl font-semibold text-white">
                {consensus.outcome}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-emerald-400">
                quorum
              </div>
              <div className="font-mono text-2xl text-emerald-100">
                {consensus.quorumSize}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-emerald-400">
                weighted score
              </div>
              <div className="font-mono text-2xl text-emerald-100">
                {consensus.weightedScore?.toFixed(3) ?? "—"}
              </div>
            </div>
          </div>
        </section>
      )}

      {onchain.postedTxHash && (
        <section className="rounded-2xl border border-amber-700/60 bg-amber-950/30 p-5">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-amber-300">
            Recorded on-chain
          </h2>
          <div className="grid gap-2 text-sm text-zinc-200 sm:grid-cols-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-amber-300">
                tx hash
              </div>
              <code className="text-amber-100">
                {shortHex(onchain.postedTxHash, 12, 10)}
              </code>
              {txUrl && (
                <a
                  href={txUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 text-xs text-amber-300 underline hover:text-amber-200"
                >
                  view ↗
                </a>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-amber-300">
                posted by
              </div>
              <code className="text-amber-100">{shortHex(onchain.postedBy)}</code>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-amber-300">
                registry
              </div>
              <code className="text-amber-100">
                {shortHex(onchain.registryAddress)}
              </code>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-amber-300">
                chain id
              </div>
              <code className="text-amber-100">{onchain.chainId ?? "—"}</code>
            </div>
          </div>
        </section>
      )}

      <footer className="mt-auto pt-6 text-xs text-zinc-600">
        polling /api/state · {state ? "connected" : "starting"} ·{" "}
        {activeQuestionId && `q=${shortHex(activeQuestionId, 6, 4)}`}
      </footer>
    </main>
  );
}
