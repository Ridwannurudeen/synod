/**
 * viem reader for SynodRegistry. Pure read paths only; no signing happens
 * in the UI — settler agents own all writes.
 */

import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http, type Hex } from "viem";

import { verifySettlementProof } from "./proof-verifier";
import { SYNOD_REGISTRY_ABI } from "./registry-abi";
import type { ProofVerificationView } from "./types";

export interface SynodRegistryConfig {
  rpcUrl: string;
  registryAddress: Hex;
}

function validateRegistryConfig(rpc: string | undefined, addr: string | undefined): SynodRegistryConfig | null {
  if (!rpc || !addr) return null;
  if (!addr.startsWith("0x") || addr.length !== 42) {
    throw new Error(
      `SYNOD_REGISTRY_ADDRESS must be a 0x-prefixed 20-byte hex; got: ${addr}`
    );
  }
  return { rpcUrl: rpc, registryAddress: addr as Hex };
}

export function loadConfig(): SynodRegistryConfig | null {
  const envConfig = validateRegistryConfig(
    process.env.SYNOD_RPC_URL,
    process.env.SYNOD_REGISTRY_ADDRESS
  );
  if (envConfig) return envConfig;

  const runtimeConfigPath =
    process.env.SYNOD_DEMO_RUNTIME_CONFIG ??
    path.join(/*turbopackIgnore: true*/ process.cwd(), ".synod-demo-runtime.json");
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ runtimeConfigPath, "utf8");
    const parsed = JSON.parse(raw) as { rpcUrl?: string; registryAddress?: string };
    return validateRegistryConfig(parsed.rpcUrl, parsed.registryAddress);
  } catch {
    return null;
  }
}

export interface OnchainSettlement {
  questionId: Hex;
  outcome: number;
  quorumSize: bigint;
  weightedScoreScaled: bigint;
  signedVotesPayload: Hex;
  postedBy: Hex;
  timestamp: bigint;
}

export interface OnchainSummary {
  registryAddress?: Hex;
  chainId?: number;
  registeredSettlerCount?: number;
  settlement?: OnchainSettlement;
  proof?: ProofVerificationView;
  txHashHint?: Hex;
}

export async function readOnchainState(questionIdHex: string): Promise<OnchainSummary> {
  const cfg = loadConfig();
  if (!cfg) return {};

  const client = createPublicClient({
    transport: http(cfg.rpcUrl),
  });

  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch {
    return { registryAddress: cfg.registryAddress };
  }
  const summary: OnchainSummary = {
    registryAddress: cfg.registryAddress,
    chainId,
  };

  try {
    const count = await client.readContract({
      address: cfg.registryAddress,
      abi: SYNOD_REGISTRY_ABI,
      functionName: "registeredSettlerCount",
    });
    summary.registeredSettlerCount = Number(count);
  } catch {
    // Registry not deployed at this address yet; surface what we have.
    return summary;
  }

  if (!questionIdHex) return summary;

  let qid = questionIdHex;
  if (!qid.startsWith("0x")) qid = `0x${qid}`;
  if (qid.length !== 66) return summary;

  let settled: unknown;
  try {
    settled = await client.readContract({
      address: cfg.registryAddress,
      abi: SYNOD_REGISTRY_ABI,
      functionName: "isSettled",
      args: [qid as Hex],
    });
  } catch {
    return summary;
  }
  if (!settled) return summary;

  let settlement: OnchainSettlement;
  try {
    settlement = (await client.readContract({
      address: cfg.registryAddress,
      abi: SYNOD_REGISTRY_ABI,
      functionName: "getSettlement",
      args: [qid as Hex],
    })) as unknown as OnchainSettlement;
  } catch {
    return summary;
  }

  summary.settlement = settlement;
  try {
    summary.proof = await verifySettlementProof(client, cfg.registryAddress, settlement);
  } catch (err) {
    summary.proof = {
      status: "invalid",
      errors: [err instanceof Error ? err.message : String(err)],
      votes: [],
    };
  }
  return summary;
}
