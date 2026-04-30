/**
 * GET /api/agent/{ensName}
 *
 * Resolves an agent's full profile by ENS name. Designed as a public
 * resolution endpoint other AI projects can hit to look up Synod settlers.
 *
 * Returns:
 *   {
 *     ensName, addr, role, pubkey, parent,                  // from synodai.eth subname
 *     registry: { address, registered, modelTag, axlPubKey, pubkeyMatchesEns },  // from on-chain
 *     online, ipv6, peerCount,                              // from live AXL daemon
 *   }
 *
 * Example:
 *   curl https://synod.gudman.xyz/api/agent/settler-a.synodai.eth
 */

import { NextResponse } from "next/server";
import { createPublicClient, http, namehash, type Hex } from "viem";
import { mainnet } from "viem/chains";

import { loadConfig } from "@/lib/registry";
import { SYNOD_REGISTRY_ABI } from "@/lib/registry-abi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

const ETH_RPC =
  process.env.SYNOD_UI_ENS_RPC ?? "https://ethereum-rpc.publicnode.com";

const ensClient = createPublicClient({ chain: mainnet, transport: http(ETH_RPC) });

const AXL_API_MAP: Record<string, string> = {
  "settler-a.synodai.eth": "http://127.0.0.1:9002",
  "settler-b.synodai.eth": "http://127.0.0.1:9012",
  "settler-c.synodai.eth": "http://127.0.0.1:9022",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ensName: string }> }
): Promise<NextResponse> {
  const { ensName } = await ctx.params;
  const fqn = decodeURIComponent(ensName).toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+){1,3}$/.test(fqn)) {
    return NextResponse.json({ error: "invalid ENS name" }, { status: 400 });
  }
  if (!fqn.endsWith(".synodai.eth")) {
    return NextResponse.json(
      { error: `only synodai.eth subnames resolve here; got ${fqn}` },
      { status: 400 }
    );
  }

  const node = namehash(fqn) as Hex;

  // 1. ENS resolution (mainnet)
  let addr: Hex;
  let role: string;
  let pubkey: string;
  let parent: string;
  try {
    [addr, role, pubkey, parent] = await Promise.all([
      ensClient.readContract({
        address: PUBLIC_RESOLVER,
        abi: RESOLVER_ABI,
        functionName: "addr",
        args: [node],
      }) as Promise<Hex>,
      ensClient.readContract({
        address: PUBLIC_RESOLVER,
        abi: RESOLVER_ABI,
        functionName: "text",
        args: [node, "synod.role"],
      }) as Promise<string>,
      ensClient.readContract({
        address: PUBLIC_RESOLVER,
        abi: RESOLVER_ABI,
        functionName: "text",
        args: [node, "synod.pubkey"],
      }) as Promise<string>,
      ensClient.readContract({
        address: PUBLIC_RESOLVER,
        abi: RESOLVER_ABI,
        functionName: "text",
        args: [node, "synod.parent"],
      }) as Promise<string>,
    ]);
  } catch (e) {
    return NextResponse.json(
      { error: `ENS resolution failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }
  if (!addr || addr === "0x0000000000000000000000000000000000000000") {
    return NextResponse.json(
      { error: `${fqn} has no addr record` },
      { status: 404 }
    );
  }

  // 2. On-chain registry (Gensyn L2)
  let registryRaw:
    | {
        address: string;
        registered: boolean;
        axlPubKey?: string;
        modelTag?: string;
        pubkeyMatchesEns?: boolean;
      }
    | null = null;
  const cfg = await loadConfig();
  if (cfg) {
    try {
      const l2 = createPublicClient({ transport: http(cfg.rpcUrl) });
      const tuple = (await l2.readContract({
        address: cfg.registryAddress,
        abi: SYNOD_REGISTRY_ABI,
        functionName: "settlers",
        args: [addr],
      })) as [boolean, string, string];
      const [registered, axlPubKey, modelTag] = tuple;
      const axlClean = axlPubKey?.startsWith("0x") ? axlPubKey.slice(2) : axlPubKey;
      registryRaw = {
        address: cfg.registryAddress,
        registered,
        axlPubKey: axlClean,
        modelTag,
        pubkeyMatchesEns:
          !!pubkey && !!axlClean && pubkey.toLowerCase() === axlClean.toLowerCase(),
      };
    } catch {
      // settler tuple read failed — surface ENS data without registry
    }
  }

  // 3. Live AXL daemon probe
  let live: { online: boolean; ipv6?: string; peerCount?: number } = { online: false };
  const axlApi = AXL_API_MAP[fqn];
  if (axlApi) {
    try {
      const r = await fetch(`${axlApi}/topology`, {
        cache: "no-store",
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) {
        const j = (await r.json()) as {
          our_ipv6?: string;
          peers?: { up: boolean }[];
        };
        live = {
          online: true,
          ipv6: j.our_ipv6,
          peerCount: Array.isArray(j.peers) ? j.peers.filter((p) => p.up).length : 0,
        };
      }
    } catch {
      // daemon offline — fall through
    }
  }

  return NextResponse.json(
    {
      ensName: fqn,
      addr,
      role,
      pubkey,
      parent,
      registry: registryRaw,
      live,
      lookupTimeMs: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
