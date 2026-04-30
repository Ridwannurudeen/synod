/**
 * ENS-as-source-of-truth for Synod runtime config.
 *
 * Cold-boot path: UI reads `synodai.eth` parent text records on Ethereum
 * mainnet, plus `settler-{a,b,c}.synodai.eth` subnames for the canonical
 * settler list. Removing a subname removes the settler from the UI.
 * Changing `synod.registry` swings the UI to a different deployment.
 *
 * Cached per-process for ENS_CACHE_TTL_MS to keep page loads fast without
 * making ENS cosmetic — first request after cold boot pays the network round
 * trip; subsequent requests hit the cache.
 */

import { createPublicClient, http, namehash, type Hex } from "viem";
import { mainnet } from "viem/chains";

const SYNOD_PARENT = "synodai.eth";
const ENS_RPC =
  process.env.SYNOD_UI_ENS_RPC ?? "https://ethereum-rpc.publicnode.com";
const ENS_CACHE_TTL_MS = 60_000;

// PublicResolver v3 (set on synodai.eth at register time). We call it directly
// for `text(node, key)` and `addr(node)` to keep this lookup deterministic and
// CCIP-free — we control the resolver.
const PUBLIC_RESOLVER: Hex = "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63";

const RESOLVER_ABI = [
  {
    name: "text",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ type: "string" }],
  },
  {
    name: "addr",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

export type SynodEnsParent = {
  parent: string;
  registryAddress: Hex;
  chainId: number;
  rpcUrl: string;
  threshold: number;
  url?: string;
  description?: string;
  github?: string;
  verifyUrl?: string;
  networkUrl?: string;
};

export type SynodEnsSubname = {
  fqn: string; // e.g. "settler-a.synodai.eth"
  label: string; // e.g. "settler-a"
  evmAddress: Hex;
  role: string;
  pubkey: string; // hex, no 0x
  parent: string;
};

export type SynodEnsView = {
  source: "ens" | "fallback";
  parent?: SynodEnsParent;
  subnames: SynodEnsSubname[];
  resolvedAtMs: number;
  ensRpcUrl: string;
  errors?: string[];
};

let cached: { view: SynodEnsView; expiresAt: number } | null = null;

const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(ENS_RPC),
});

async function readText(node: Hex, key: string): Promise<string> {
  return (await ensClient.readContract({
    address: PUBLIC_RESOLVER,
    abi: RESOLVER_ABI,
    functionName: "text",
    args: [node, key],
  })) as string;
}

async function readAddr(node: Hex): Promise<Hex> {
  return (await ensClient.readContract({
    address: PUBLIC_RESOLVER,
    abi: RESOLVER_ABI,
    functionName: "addr",
    args: [node],
  })) as Hex;
}

const PARENT_TEXT_KEYS = [
  "synod.registry",
  "synod.chain-id",
  "synod.rpc",
  "synod.threshold",
  "url",
  "description",
  "com.github",
  "synod.verify-url",
  "synod.network-url",
] as const;

const SUBNAME_LABELS = ["settler-a", "settler-b", "settler-c", "settler-d"] as const;

const SUBNAME_TEXT_KEYS = ["synod.role", "synod.pubkey", "synod.parent"] as const;

async function resolveParent(): Promise<SynodEnsParent | null> {
  const parentNode = namehash(SYNOD_PARENT) as Hex;
  const values = await Promise.all(
    PARENT_TEXT_KEYS.map((k) => readText(parentNode, k).catch(() => ""))
  );
  const map = Object.fromEntries(
    PARENT_TEXT_KEYS.map((k, i) => [k, values[i]])
  );

  const reg = map["synod.registry"];
  const chainStr = map["synod.chain-id"];
  const rpc = map["synod.rpc"];
  const threshStr = map["synod.threshold"];
  if (!reg || !chainStr || !rpc) return null;
  if (!reg.startsWith("0x") || reg.length !== 42) return null;
  const chainId = Number(chainStr);
  if (!Number.isFinite(chainId) || chainId <= 0) return null;
  const threshold = Number(threshStr || "2");

  return {
    parent: SYNOD_PARENT,
    registryAddress: reg as Hex,
    chainId,
    rpcUrl: rpc,
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 2,
    url: map["url"] || undefined,
    description: map["description"] || undefined,
    github: map["com.github"] || undefined,
    verifyUrl: map["synod.verify-url"] || undefined,
    networkUrl: map["synod.network-url"] || undefined,
  };
}

async function resolveSubname(label: string): Promise<SynodEnsSubname | null> {
  const fqn = `${label}.${SYNOD_PARENT}`;
  const node = namehash(fqn) as Hex;
  const [addr, role, pubkey, parent] = await Promise.all([
    readAddr(node).catch(() => "0x0000000000000000000000000000000000000000" as Hex),
    readText(node, "synod.role").catch(() => ""),
    readText(node, "synod.pubkey").catch(() => ""),
    readText(node, "synod.parent").catch(() => ""),
  ]);
  if (!addr || addr === "0x0000000000000000000000000000000000000000") return null;
  if (!role || !pubkey) return null;
  return { fqn, label, evmAddress: addr, role, pubkey, parent };
}

export async function resolveEnsView(): Promise<SynodEnsView> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.view;

  const errors: string[] = [];
  let parent: SynodEnsParent | null = null;
  let subnames: SynodEnsSubname[] = [];
  try {
    parent = await resolveParent();
  } catch (e) {
    errors.push(`parent: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const resolved = await Promise.all(SUBNAME_LABELS.map(resolveSubname));
    subnames = resolved.filter((s): s is SynodEnsSubname => s !== null);
  } catch (e) {
    errors.push(`subnames: ${e instanceof Error ? e.message : String(e)}`);
  }

  const view: SynodEnsView = {
    source: parent ? "ens" : "fallback",
    parent: parent ?? undefined,
    subnames,
    resolvedAtMs: Date.now(),
    ensRpcUrl: ENS_RPC,
    errors: errors.length > 0 ? errors : undefined,
  };

  cached = { view, expiresAt: Date.now() + ENS_CACHE_TTL_MS };
  return view;
}

/** Force-refresh the ENS cache. Used by /api/ens?refresh=1 for live demos. */
export function invalidateEnsCache(): void {
  cached = null;
}
