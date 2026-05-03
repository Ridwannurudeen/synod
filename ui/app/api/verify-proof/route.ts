/**
 * POST /api/verify-proof
 *
 * Body: { questionId: "<64-hex>" } (with or without 0x prefix)
 *
 * Reads the settlement from SynodRegistry, runs the full off-chain proof
 * verifier (ed25519 signatures + registry membership + recomputed quorum +
 * recomputed weighted score), and returns a ProofVerificationView. This is
 * the same code path the standalone Python CLI exercises — judges can hit
 * this from a browser instead of pulling the repo down.
 */

import { NextResponse } from "next/server";
import { createPublicClient, http, type Hex } from "viem";

import { verifySettlementProof } from "@/lib/proof-verifier";
import { loadConfig } from "@/lib/registry";
import { SYNOD_REGISTRY_ABI } from "@/lib/registry-abi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeQuestionId(input: unknown): Hex | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return `0x${hex}` as Hex;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const qid = normalizeQuestionId((body as { questionId?: unknown })?.questionId);
  if (!qid) {
    return NextResponse.json(
      { error: "questionId must be a 32-byte hex string" },
      { status: 400 }
    );
  }

  const cfg = await loadConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "server has no SYNOD_RPC_URL / SYNOD_REGISTRY_ADDRESS configured" },
      { status: 500 }
    );
  }

  const client = createPublicClient({ transport: http(cfg.rpcUrl) });

  // Brief retry helper — Gensyn L2 public RPC sometimes throws 429 under demo load.
  async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        // Only retry on rate-limit / transient errors; bail fast on real reverts.
        if (!/429|rate|too many|timeout|network/i.test(msg)) throw e;
        await new Promise((r) => setTimeout(r, 400 * (i + 1) + Math.random() * 200));
      }
    }
    throw lastErr;
  }

  // Settlement existence check
  let settled: boolean;
  try {
    settled = (await withRetry(() =>
      client.readContract({
        address: cfg.registryAddress,
        abi: SYNOD_REGISTRY_ABI,
        functionName: "isSettled",
        args: [qid],
      })
    )) as boolean;
  } catch (e) {
    return NextResponse.json(
      {
        error: `chain read failed (isSettled): ${e instanceof Error ? e.message : String(e)}`,
        registryAddress: cfg.registryAddress,
      },
      { status: 502 }
    );
  }
  if (!settled) {
    return NextResponse.json(
      {
        status: "unavailable",
        errors: [`questionId ${qid} is not settled on-chain at ${cfg.registryAddress}`],
        votes: [],
        questionId: qid,
        registryAddress: cfg.registryAddress,
      },
      { status: 200 }
    );
  }

  // Pull the settlement tuple
  let settlement: {
    questionId: Hex;
    outcome: number;
    quorumSize: bigint;
    weightedScoreScaled: bigint;
    signedVotesPayload: Hex;
    postedBy: Hex;
    timestamp: bigint;
    challengeDeadline: bigint;
    finalized: boolean;
    challenged: boolean;
    voided: boolean;
  };
  try {
    const tuple = (await withRetry(() => client.readContract({
      address: cfg.registryAddress,
      abi: SYNOD_REGISTRY_ABI,
      functionName: "getSettlement",
      args: [qid],
    }))) as {
      questionId: Hex;
      outcome: number;
      quorumSize: bigint;
      weightedScoreScaled: bigint;
      signedVotesPayload: Hex;
      postedBy: Hex;
      timestamp: bigint;
      challengeDeadline: bigint;
      finalized: boolean;
      challenged: boolean;
      voided: boolean;
    };
    settlement = tuple;
  } catch (e) {
    return NextResponse.json(
      { error: `chain read failed (getSettlement): ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }

  const result = await verifySettlementProof(client, cfg.registryAddress, settlement);

  // Fetch security config so the UI can render the "Challenge" CTA with the
  // live minChallengeBond and a correct challenge-window countdown. These
  // reads are best-effort: missing values just disable the CTA.
  let minChallengeBond: bigint | undefined;
  let challengeWindowSeconds: bigint | undefined;
  try {
    [minChallengeBond, challengeWindowSeconds] = (await Promise.all([
      withRetry(() => client.readContract({
        address: cfg.registryAddress,
        abi: SYNOD_REGISTRY_ABI,
        functionName: "minChallengeBond",
      })),
      withRetry(() => client.readContract({
        address: cfg.registryAddress,
        abi: SYNOD_REGISTRY_ABI,
        functionName: "challengeWindowSeconds",
      })),
    ])) as [bigint, bigint];
  } catch {
    // tolerate
  }

  return NextResponse.json(
    {
      ...result,
      registryAddress: cfg.registryAddress,
      chainId: await client.getChainId().catch(() => undefined),
      onchain: {
        outcome: settlement.outcome,
        quorumSize: Number(settlement.quorumSize),
        weightedScoreScaled: Number(settlement.weightedScoreScaled),
        postedBy: settlement.postedBy,
        timestamp: Number(settlement.timestamp),
        challengeDeadline: Number(settlement.challengeDeadline),
        finalized: settlement.finalized,
        challenged: settlement.challenged,
        voided: settlement.voided,
      },
      security: {
        minChallengeBond: minChallengeBond !== undefined ? minChallengeBond.toString() : null,
        challengeWindowSeconds: challengeWindowSeconds !== undefined ? Number(challengeWindowSeconds) : null,
      },
    },
    { status: 200 }
  );
}
