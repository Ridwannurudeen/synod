/**
 * GET /api/dashboard
 *
 * Composes the public-facing stats dashboard view from on-chain
 * SettlementRecorded logs (chain-canonical), runtime/transcripts.json
 * (operator-side index), runtime/judgments.json, /api/network state, and
 * resolved ENS records.
 *
 * This is the only stats endpoint that uses eth_getLogs as ground truth
 * for settlement count — every other counter is local-file-derived. Result
 * is cached in-process for DASHBOARD_CACHE_TTL_MS to keep the RPC happy.
 */

import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  decodeEventLog,
  type Hex,
  type Log,
} from "viem";

import { resolveEnsView } from "@/lib/ens";
import { gatherNetworkState } from "@/lib/network";
import { loadConfig } from "@/lib/registry";
import { SYNOD_REGISTRY_ABI } from "@/lib/registry-abi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DASHBOARD_CACHE_TTL_MS = 60_000;
// Pin to a block well before the registry's first settlement so getLogs
// doesn't scan the entire chain history on every cold cache miss. Gensyn L2
// is young (~10M blocks total as of 2026-05) and our first settlement was
// around block 9.4M; 9M is a safe lower bound that captures every event
// without bringing in years of unrelated chain history. Override via
// SYNOD_DASHBOARD_FROM_BLOCK.
const DEFAULT_FROM_BLOCK = BigInt(
  process.env.SYNOD_DASHBOARD_FROM_BLOCK ?? "9000000",
);
// Single-flight guard so N concurrent cold-cache hits trigger ONE RPC scan,
// not N — closes the dashboard-cache-stampede vector flagged in audit M1.
let inflight: Promise<DashboardView> | null = null;

type SettlementLog = {
  questionId: Hex;
  outcome: number;
  quorumSize: number;
  weightedScoreScaled: number;
  postedBy: Hex;
  txHash: Hex;
  blockNumber: number;
  timestamp: number;
};

type SettlerStats = {
  name: string;
  ensFqn: string;
  evmAddress: string;
  axlPubkey: string;
  modelTag: string;
  online: boolean;
  registered: boolean;
  appearances: number;
  agreedWithConsensus: number;
  agreementRate: number | null;
  lastVoteAtMs: number | null;
};

type DashboardView = {
  generatedAtMs: number;
  network: {
    chainId: number;
    registryAddress: string;
    rpcUrl: string;
    settlementsAllTime: number;
    settlementsLast24h: number;
    avgTimeToConsensusMs: number | null;
    meshEdgeCount: number;
  };
  settlers: SettlerStats[];
  recentSettlements: Array<{
    questionId: string;
    outcome: number;
    quorumSize: number;
    weightedScoreScaled: number;
    postedBy: string;
    txHash: string;
    blockNumber: number;
    timestamp: number;
    judgmentSubname?: string;
  }>;
  storage: {
    network: string;
    indexerUrl: string;
    transcriptCount: number;
    transcriptBytes: number;
    sampleRoot: string | null;
  };
  ens: {
    parent: string;
    source: "ens" | "fallback";
    parentRecordCount: number;
    subnameCount: number;
    threshold: number;
  };
  totalWeightedScoreScaled: number;
};

type CacheEntry = { view: DashboardView; expiresAt: number };
let cached: CacheEntry | null = null;
let oneTimeErrorLogged = false;

function logOnce(msg: string): void {
  if (oneTimeErrorLogged) return;
  oneTimeErrorLogged = true;
  // eslint-disable-next-line no-console
  console.error(`[dashboard] ${msg}`);
}

function transcriptsPath(): string {
  return (
    process.env.SYNOD_TRANSCRIPTS_FILE ??
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "runtime", "transcripts.json")
  );
}

function judgmentsPath(): string {
  return (
    process.env.SYNOD_JUDGMENTS_FILE ??
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "runtime", "judgments.json")
  );
}

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

function readJsonMap<T>(p: string): Record<string, T> {
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8");
    const j = JSON.parse(raw);
    return typeof j === "object" && j !== null ? (j as Record<string, T>) : {};
  } catch {
    return {};
  }
}

const SETTLEMENT_RECORDED_EVENT = SYNOD_REGISTRY_ABI.find(
  (x) => x.type === "event" && x.name === "SettlementRecorded"
)!;

async function fetchSettlementLogs(
  rpcUrl: string,
  registryAddress: Hex
): Promise<SettlementLog[]> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const logs = (await client.getLogs({
    address: registryAddress,
    event: SETTLEMENT_RECORDED_EVENT,
    fromBlock: DEFAULT_FROM_BLOCK,
    toBlock: "latest",
  })) as unknown as Log[];

  // Block timestamps require getBlock per unique block. Batch unique blocks
  // and fan-out — bounded by the number of distinct blocks, not logs.
  const uniqueBlocks = Array.from(
    new Set(logs.map((l) => l.blockNumber).filter((n): n is bigint => n !== null))
  );
  const blockTimes = new Map<bigint, number>();
  await Promise.all(
    uniqueBlocks.map(async (bn) => {
      try {
        const b = await client.getBlock({ blockNumber: bn });
        blockTimes.set(bn, Number(b.timestamp));
      } catch {
        // skip — log will get timestamp 0 and be excluded from 24h window
      }
    })
  );

  const out: SettlementLog[] = [];
  for (const l of logs) {
    if (l.blockNumber === null || l.transactionHash === null) continue;
    try {
      const decoded = decodeEventLog({
        abi: SYNOD_REGISTRY_ABI,
        eventName: "SettlementRecorded",
        data: l.data,
        topics: l.topics,
      });
      const args = decoded.args as {
        questionId: Hex;
        outcome: number;
        quorumSize: bigint;
        weightedScoreScaled: bigint;
        postedBy: Hex;
      };
      out.push({
        questionId: args.questionId,
        outcome: Number(args.outcome),
        quorumSize: Number(args.quorumSize),
        weightedScoreScaled: Number(args.weightedScoreScaled),
        postedBy: args.postedBy,
        txHash: l.transactionHash,
        blockNumber: Number(l.blockNumber),
        timestamp: blockTimes.get(l.blockNumber) ?? 0,
      });
    } catch {
      // malformed log — skip, don't crash the page
    }
  }
  // Sorted oldest -> newest by block
  out.sort((a, b) => a.blockNumber - b.blockNumber);
  return out;
}

async function computeSettlerStats(
  ensFqn: string,
  axlPubkey: string,
  evmAddress: string,
  modelTag: string,
  online: boolean,
  registered: boolean,
  transcripts: Record<string, TranscriptEntry>,
  name: string
): Promise<SettlerStats> {
  // Sample only the most recent N transcripts to keep request bounded — same
  // pattern used by /api/agent/[ensName].
  const entries = Object.entries(transcripts).slice(-20);
  let total = 0;
  let agreed = 0;
  let lastVoteAtMs: number | null = null;
  const ourPubkey = axlPubkey.toLowerCase().replace(/^0x/, "");

  if (ourPubkey) {
    const docs = await Promise.all(
      entries.map(async ([_qid, e]) => {
        if (!e.indexer_url) return null;
        try {
          const r = await fetch(e.indexer_url, {
            cache: "no-store",
            signal: AbortSignal.timeout(2500),
          });
          if (!r.ok) return null;
          return (await r.json()) as {
            outcome?: number;
            posted_at?: number;
            votes?: { settler_pubkey?: string; outcome?: number }[];
          };
        } catch {
          return null;
        }
      })
    );

    for (const doc of docs) {
      if (!doc || typeof doc.outcome !== "number" || !Array.isArray(doc.votes)) continue;
      const myVote = doc.votes.find(
        (v) => v.settler_pubkey?.toLowerCase().replace(/^0x/, "") === ourPubkey
      );
      if (!myVote) continue;
      total += 1;
      if (myVote.outcome === doc.outcome) agreed += 1;
      if (typeof doc.posted_at === "number") {
        const ms = doc.posted_at * 1000;
        if (lastVoteAtMs === null || ms > lastVoteAtMs) lastVoteAtMs = ms;
      }
    }
  }

  return {
    name,
    ensFqn,
    evmAddress,
    axlPubkey,
    modelTag,
    online,
    registered,
    appearances: total,
    agreedWithConsensus: agreed,
    agreementRate: total > 0 ? Math.round((agreed / total) * 1000) / 1000 : null,
    lastVoteAtMs,
  };
}

async function buildDashboard(): Promise<DashboardView> {
  const [cfg, ens, network] = await Promise.all([
    loadConfig(),
    resolveEnsView(),
    gatherNetworkState(),
  ]);

  const transcripts = readJsonMap<TranscriptEntry>(transcriptsPath());
  const judgments = readJsonMap<JudgmentEntry>(judgmentsPath());

  // Total weighted score & settlement logs from chain
  let settlementLogs: SettlementLog[] = [];
  if (cfg) {
    try {
      settlementLogs = await fetchSettlementLogs(cfg.rpcUrl, cfg.registryAddress);
    } catch (e) {
      logOnce(
        `eth_getLogs failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const settlementsLast24h = settlementLogs.filter(
    (l) => l.timestamp > 0 && nowSec - l.timestamp < 86_400
  ).length;

  // Recent 20, newest first
  const recentSettlements = settlementLogs
    .slice(-20)
    .reverse()
    .map((l) => {
      const qidNo0x = l.questionId.replace(/^0x/, "");
      const judgment =
        judgments[l.questionId] ??
        judgments[qidNo0x] ??
        judgments[`0x${qidNo0x}`];
      return {
        questionId: l.questionId,
        outcome: l.outcome,
        quorumSize: l.quorumSize,
        weightedScoreScaled: l.weightedScoreScaled,
        postedBy: l.postedBy,
        txHash: l.txHash,
        blockNumber: l.blockNumber,
        timestamp: l.timestamp,
        judgmentSubname: judgment?.fqn,
      };
    });

  const totalWeightedScoreScaled = settlementLogs.reduce(
    (s, l) => s + l.weightedScoreScaled,
    0
  );

  // Settler grid: cross product of network nodes (live) + ENS subnames (canonical)
  const settlers: SettlerStats[] = await Promise.all(
    network.nodes.map((n) =>
      computeSettlerStats(
        n.spec.ensFqn ?? "",
        n.pubkey ?? n.registeredAxlPubKey ?? "",
        n.spec.evmAddress,
        n.registeredModelTag ?? "",
        n.online,
        n.registered,
        transcripts,
        n.spec.name
      )
    )
  );

  // Storage block
  const transcriptCount = Object.keys(transcripts).length;
  const transcriptBytes = Object.values(transcripts).reduce<number>(
    (s, e) => s + (typeof e.bytes === "number" ? e.bytes : 0),
    0
  );
  const sampleRoot =
    Object.values(transcripts).find((e) => e.root)?.root ?? null;

  // ENS block
  const parentRecordCount = ens.parent
    ? [
        ens.parent.registryAddress,
        ens.parent.rpcUrl,
        ens.parent.chainId,
        ens.parent.threshold,
        ens.parent.url,
        ens.parent.description,
        ens.parent.github,
        ens.parent.verifyUrl,
        ens.parent.networkUrl,
      ].filter((v) => v !== undefined && v !== "").length
    : 0;

  const view: DashboardView = {
    generatedAtMs: Date.now(),
    network: {
      chainId: cfg?.chainId ?? network.chainId ?? 685689,
      registryAddress:
        cfg?.registryAddress ?? network.registryAddress ?? "",
      rpcUrl: cfg?.rpcUrl ?? "",
      settlementsAllTime: settlementLogs.length,
      settlementsLast24h,
      avgTimeToConsensusMs: null, // omitted in v1: requires per-question off-chain anchors
      meshEdgeCount: network.edges.length,
    },
    settlers,
    recentSettlements,
    storage: {
      network: "0g-storage-testnet-turbo",
      indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
      transcriptCount,
      transcriptBytes,
      sampleRoot,
    },
    ens: {
      parent: ens.parent?.parent ?? "synodai.eth",
      source: ens.source,
      parentRecordCount,
      subnameCount: ens.subnames.length,
      threshold: ens.parent?.threshold ?? 2,
    },
    totalWeightedScoreScaled,
  };

  return view;
}

export async function GET(): Promise<NextResponse> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.view, {
      headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    // Single-flight: concurrent cold-cache requests share one buildDashboard()
    // promise, so a hostile loop of curl /api/dashboard cannot trigger N
    // simultaneous full-history eth_getLogs scans on the public RPC.
    if (!inflight) {
      inflight = buildDashboard().finally(() => {
        inflight = null;
      });
    }
    const view = await inflight;
    cached = { view, expiresAt: now + DASHBOARD_CACHE_TTL_MS };
    return NextResponse.json(view, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    logOnce(`build failed: ${e instanceof Error ? e.message : String(e)}`);
    if (cached) {
      // serve stale rather than break the dashboard
      return NextResponse.json(cached.view, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json(
      { error: "dashboard composition failed" },
      { status: 500 }
    );
  }
}
