/**
 * GET /api/state
 *
 * Aggregates the current snapshot of the deliberation: per-settler view from
 * agent log files, the latest off-chain consensus, and the on-chain
 * SynodRegistry projection if configured.
 *
 * The page polls this on a 500ms cadence; everything inside is cheap (a few
 * file reads + at most three eth_calls).
 */

import { NextResponse } from "next/server";

import { PRIMARY_AXL_API, SETTLER_LOG_FILES } from "@/lib/config";
import { parseSettlerLogs } from "@/lib/log-parser";
import { readOnchainState } from "@/lib/registry";
import type {
  ConsensusView,
  DeliberationState,
  OnchainView,
  SettlerView,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function probePrimaryAxl(): Promise<{ pubkey?: string; online: boolean }> {
  try {
    const res = await fetch(`${PRIMARY_AXL_API}/topology`, {
      cache: "no-store",
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return { online: false };
    const j = (await res.json()) as { our_public_key?: string };
    return { pubkey: j.our_public_key, online: true };
  } catch {
    return { online: false };
  }
}

export async function GET(): Promise<NextResponse> {
  const [parsed, primary] = await Promise.all([
    parseSettlerLogs(SETTLER_LOG_FILES),
    probePrimaryAxl(),
  ]);

  // Merge primary AXL's online status into the SettlerView for that node, if
  // we recognize it from log parsing. Otherwise add a placeholder so the UI
  // shows it even before any deliberation runs.
  const settlers: SettlerView[] = [...parsed.settlers];
  if (primary.online && primary.pubkey) {
    const found = settlers.find((s) => s.pubkey === primary.pubkey);
    if (found) {
      found.online = true;
    } else {
      settlers.push({
        pubkey: primary.pubkey,
        online: true,
        status: "idle",
        lastUpdateMs: Date.now(),
      });
    }
  }

  const consensus: ConsensusView | null = parsed.consensus;
  const onchain: OnchainView = {};

  if (consensus?.questionId) {
    const summary = await readOnchainState(consensus.questionId);
    onchain.registryAddress = summary.registryAddress;
    onchain.chainId = summary.chainId;
    if (summary.settlement) {
      onchain.outcome = summary.settlement.outcome;
      onchain.weightedScoreScaled = Number(summary.settlement.weightedScoreScaled);
      onchain.postedBy = summary.settlement.postedBy;
      onchain.postedAt = Number(summary.settlement.timestamp) * 1000;
      onchain.finalized = Boolean(summary.settlement.finalized);
      if (summary.settlement.challengeDeadline !== undefined) {
        onchain.challengeDeadline = Number(summary.settlement.challengeDeadline) * 1000;
      }
      onchain.challenged = Boolean(summary.settlement.challenged);
      onchain.voided = Boolean(summary.settlement.voided);
      onchain.challenger = summary.settlement.challenger;
      onchain.challengeEvidenceHash = summary.settlement.challengeEvidenceHash;
      onchain.challengeReason = summary.settlement.challengeReason;
      if (summary.settlement.challengeBond !== undefined) {
        onchain.challengeBond = summary.settlement.challengeBond.toString();
      }
      onchain.proof = summary.proof;
    }
    if (parsed.onchainTxHash) {
      onchain.postedTxHash = `0x${parsed.onchainTxHash}`;
    }
  }

  const body: DeliberationState = {
    consensus,
    settlers,
    onchain,
    serverTimeMs: Date.now(),
  };

  return NextResponse.json(body);
}
