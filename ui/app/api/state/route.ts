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
import { gatherNetworkState } from "@/lib/network";
import { readOnchainState } from "@/lib/registry";
import type {
  ConsensusView,
  DeliberationState,
  OnchainView,
  SettlerView,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Hardcoded fallback model tags for the 4 known settlers. The on-chain
// `settlers()` call sometimes returns null `registeredModelTag` under RPC
// load — without a fallback, the deliberation cards flash "model: tbd"
// during exactly the moments the user is most likely to be looking at the
// page (right after inject). The mapping below is stable for the v1
// deployment; replace with a dynamic registry lookup once we redeploy.
const KNOWN_MODEL_TAGS: Record<string, string> = {
  "752b498760a859332985f4d1edf6a630cd97615c0f1085c63e514736326c1cea":
    "claude-sonnet-4-6",
  "b52678486f667f176885421b48b06ff3569468e242839f32f6db9ebd1083fbc8":
    "claude-haiku-4-5",
  "dbc4cebd7a1bb7a4f9d06dd1ae9376807d4bc0d314b89839aef75e1988ed3648":
    "zerog/qwen-2.5-7b-instruct",
  "ab3a7aba135d3b24ef18f87e3115a5c4f853e9628e685e8671a3a53355db11c0":
    "claude-opus-4-7",
};

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
  const [parsed, primary, network] = await Promise.all([
    parseSettlerLogs(SETTLER_LOG_FILES),
    probePrimaryAxl(),
    gatherNetworkState().catch(() => ({ nodes: [] as Array<{
      spec: { name: string };
      pubkey?: string;
      registeredAxlPubKey?: string;
      registeredModelTag?: string;
      online: boolean;
    }> })),
  ]);

  // Build the deliberation card list from the registered swarm (4 settlers
  // across both VPS) so the homepage always shows the full quorum, not just
  // settlers whose logs live on the local box. Log-parsed vote data is
  // overlaid on top — that's what shows ed25519 sigs / outcomes / model tags
  // for the LIVE inference, while the network probe gives us the baseline
  // identity + online status for nodes whose logs are on the other VPS.
  const byPubkey = new Map<string, SettlerView>();
  for (const node of network.nodes) {
    const pk = node.pubkey || node.registeredAxlPubKey;
    if (!pk) continue;
    byPubkey.set(pk, {
      pubkey: pk,
      modelTag: node.registeredModelTag || KNOWN_MODEL_TAGS[pk],
      online: Boolean(node.online),
      status: "idle",
      lastUpdateMs: Date.now(),
    });
  }
  // Belt-and-braces: ensure the 4 known settlers always appear, even when
  // gatherNetworkState() returns empty (RPC flap, ENS read failure, etc.).
  for (const [pk, modelTag] of Object.entries(KNOWN_MODEL_TAGS)) {
    if (!byPubkey.has(pk)) {
      byPubkey.set(pk, {
        pubkey: pk,
        modelTag,
        online: false,
        status: "idle",
        lastUpdateMs: Date.now(),
      });
    }
  }
  for (const s of parsed.settlers) {
    const existing = byPubkey.get(s.pubkey);
    if (existing) {
      byPubkey.set(s.pubkey, {
        ...existing,
        ...s,
        modelTag: s.modelTag || existing.modelTag || KNOWN_MODEL_TAGS[s.pubkey],
        online: s.online || existing.online,
      });
    } else {
      byPubkey.set(s.pubkey, {
        ...s,
        modelTag: s.modelTag || KNOWN_MODEL_TAGS[s.pubkey],
      });
    }
  }

  // Cross-settler vote overlay: when a settler's logs aren't local
  // (e.g. settler-d on the Toronto VPS), the "accepted vote" line in
  // another settler's log still tells us how they voted. Apply that
  // overlay to any settler card that doesn't yet have a votedOutcome.
  const xVotes = parsed.acceptedVotesByPubkeyPrefix || {};
  for (const [pk, view] of byPubkey.entries()) {
    if (view.votedOutcome !== undefined) continue;
    const pfx = pk.slice(0, 16);
    const v = xVotes[pfx];
    if (v) {
      byPubkey.set(pk, {
        ...view,
        votedOutcome: v.outcome,
        status: "voted",
      });
    }
  }

  const settlers: SettlerView[] = Array.from(byPubkey.values());
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
