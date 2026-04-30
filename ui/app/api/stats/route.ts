/**
 * GET /api/stats
 *
 * Live protocol counters for the homepage hero:
 *   - questionsSettled: from SynodRegistry.settledCount() (or counts via storage)
 *   - judgmentsMinted: count of entries in runtime/judgments.json
 *   - transcriptsKB: total bytes of transcripts persisted to 0G Storage
 *
 * Read-mostly; cached for 10s on the server side to keep the homepage snappy.
 */

import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";

import { loadConfig } from "@/lib/registry";
import { SYNOD_REGISTRY_ABI } from "@/lib/registry-abi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let cached: { stats: object; expiresAt: number } | null = null;

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

function readJsonMap(p: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8");
    const j = JSON.parse(raw);
    return typeof j === "object" && j !== null ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function GET(): Promise<NextResponse> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.stats, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const transcripts = readJsonMap(transcriptsPath());
  const judgments = readJsonMap(judgmentsPath());

  let transcriptsKB = 0;
  for (const entry of Object.values(transcripts)) {
    const e = entry as { bytes?: number };
    if (typeof e.bytes === "number") transcriptsKB += e.bytes;
  }
  transcriptsKB = Math.round(transcriptsKB / 1024);

  let questionsSettled = Object.keys(transcripts).length;
  let registeredSettlerCount: number | undefined;
  let chainId: number | undefined;
  let registryAddress: string | undefined;

  const cfg = await loadConfig();
  if (cfg) {
    registryAddress = cfg.registryAddress;
    chainId = cfg.chainId;
    try {
      const client = createPublicClient({ transport: http(cfg.rpcUrl) });
      const count = (await client.readContract({
        address: cfg.registryAddress,
        abi: SYNOD_REGISTRY_ABI,
        functionName: "registeredSettlerCount",
      })) as bigint;
      registeredSettlerCount = Number(count);
      // Some registry shapes expose settledCount(); fall back to local map size if not.
      try {
        const settled = (await client.readContract({
          address: cfg.registryAddress,
          abi: [
            ...SYNOD_REGISTRY_ABI,
            {
              name: "settledCount",
              type: "function",
              stateMutability: "view",
              inputs: [],
              outputs: [{ type: "uint256" }],
            },
          ] as const,
          functionName: "settledCount",
        })) as bigint;
        questionsSettled = Number(settled);
      } catch {
        // older registry without settledCount() — keep local count
      }
    } catch {
      // RPC offline; fall through to local-only counts
    }
  }

  const stats = {
    questionsSettled,
    judgmentsMinted: Object.keys(judgments).length,
    transcriptsKB,
    transcriptsBytes: Object.values(transcripts).reduce<number>(
      (s, e) => s + ((e as { bytes?: number }).bytes ?? 0),
      0
    ),
    registeredSettlerCount,
    registryAddress,
    chainId,
    storageNetwork: "0g-storage-testnet-turbo",
    ensParent: "synodai.eth",
    serverTimeMs: Date.now(),
  };

  cached = { stats, expiresAt: Date.now() + 10_000 };
  return NextResponse.json(stats, {
    headers: { "Cache-Control": "no-store" },
  });
}
