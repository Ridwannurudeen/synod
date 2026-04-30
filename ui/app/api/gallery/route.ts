/**
 * GET /api/gallery
 *
 * Returns the full list of settled questions with:
 *  - questionId
 *  - prompt + outcome (from on-chain settlement + 0G transcript if available)
 *  - 0G transcript pointer (root, indexerUrl, bytes)
 *  - ENS judgment subname (fqn, ensAppUrl) if minted
 *
 * Used by /gallery to render the "every question Synod has settled" page.
 */

import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TranscriptEntry = {
  root: string;
  tx: string;
  indexer_url: string;
  bytes: number;
  uploaded_at: number;
};
type JudgmentEntry = {
  fqn: string;
  label: string;
  owner: string;
  text_records: Record<string, string>;
  ens_app_url: string;
};

function readMap<T>(p: string): Record<string, T> {
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8");
    const j = JSON.parse(raw);
    return typeof j === "object" && j !== null ? (j as Record<string, T>) : {};
  } catch {
    return {};
  }
}

// Server-side cache. Each call enriches all transcripts via 0G HTTP fetches
// — without this, every poller (homepage RecentJudgments at 30s, /gallery
// at 15s, plus any judges hitting it) triggers N outbound fetches and a
// memory spike. 60s TTL keeps the data fresh enough for demo while keeping
// the heap small.
type CachedView = { count: number; items: unknown[]; serverTimeMs: number };
let cached: { view: CachedView; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function GET(): Promise<NextResponse> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.view, {
      headers: { "Cache-Control": "no-store" },
    });
  }
  const transcriptsP =
    process.env.SYNOD_TRANSCRIPTS_FILE ??
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "runtime", "transcripts.json");
  const judgmentsP =
    process.env.SYNOD_JUDGMENTS_FILE ??
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "runtime", "judgments.json");

  const transcripts = readMap<TranscriptEntry>(transcriptsP);
  const judgments = readMap<JudgmentEntry>(judgmentsP);

  // Pull prompt + outcome from each transcript via 0G indexer (parallel)
  const entries = Object.entries(transcripts);
  const enriched = await Promise.all(
    entries.map(async ([qid, tx]) => {
      let prompt = "";
      let outcome: number | null = null;
      let outcomeLabel = "";
      let postedAt = tx.uploaded_at;
      try {
        const r = await fetch(tx.indexer_url, {
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        });
        if (r.ok) {
          const doc = (await r.json()) as {
            question?: { prompt?: string; outcomes?: (number | string)[] };
            outcome?: number;
            posted_at?: number;
          };
          prompt = doc.question?.prompt ?? "";
          outcome = typeof doc.outcome === "number" ? doc.outcome : null;
          if (outcome !== null && doc.question?.outcomes) {
            const v = doc.question.outcomes[outcome];
            outcomeLabel = String(v);
          }
          if (typeof doc.posted_at === "number") postedAt = doc.posted_at;
        }
      } catch {
        // best-effort
      }

      const judgment = judgments[qid] ?? judgments[`0x${qid}`];
      return {
        questionId: `0x${qid.replace(/^0x/, "")}`,
        prompt,
        outcome,
        outcomeLabel,
        postedAt,
        transcript: {
          root: tx.root,
          indexerUrl: tx.indexer_url,
          bytes: tx.bytes,
        },
        judgment: judgment
          ? {
              fqn: judgment.fqn,
              owner: judgment.owner,
              ensAppUrl: judgment.ens_app_url,
              outcome: judgment.text_records["synod.outcome"],
              quorum: judgment.text_records["synod.quorum"],
            }
          : null,
      };
    })
  );

  enriched.sort((a, b) => b.postedAt - a.postedAt);

  const view: CachedView = {
    count: enriched.length,
    items: enriched,
    serverTimeMs: Date.now(),
  };
  cached = { view, expiresAt: Date.now() + CACHE_TTL_MS };

  return NextResponse.json(view, {
    headers: { "Cache-Control": "no-store" },
  });
}
