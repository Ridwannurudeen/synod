/**
 * viem reader for SynodRegistry. Pure read paths only; no signing happens
 * in the UI — settler agents own all writes.
 */

import { createPublicClient, http, type Hex } from "viem";

import { SYNOD_REGISTRY_ABI } from "./registry-abi";

export interface SynodRegistryConfig {
  rpcUrl: string;
  registryAddress: Hex;
}

function loadConfig(): SynodRegistryConfig | null {
  const rpc = process.env.SYNOD_RPC_URL;
  const addr = process.env.SYNOD_REGISTRY_ADDRESS;
  if (!rpc || !addr) return null;
  if (!addr.startsWith("0x") || addr.length !== 42) {
    throw new Error(
      `SYNOD_REGISTRY_ADDRESS must be a 0x-prefixed 20-byte hex; got: ${addr}`
    );
  }
  return { rpcUrl: rpc, registryAddress: addr as Hex };
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
  txHashHint?: Hex;
}

export async function readOnchainState(questionIdHex: string): Promise<OnchainSummary> {
  const cfg = loadConfig();
  if (!cfg) return {};

  const client = createPublicClient({
    transport: http(cfg.rpcUrl),
  });

  const chainId = await client.getChainId();
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

  const settled = await client.readContract({
    address: cfg.registryAddress,
    abi: SYNOD_REGISTRY_ABI,
    functionName: "isSettled",
    args: [qid as Hex],
  });
  if (!settled) return summary;

  const settlement = (await client.readContract({
    address: cfg.registryAddress,
    abi: SYNOD_REGISTRY_ABI,
    functionName: "getSettlement",
    args: [qid as Hex],
  })) as unknown as OnchainSettlement;

  summary.settlement = settlement;
  return summary;
}
