/**
 * Server-side aggregator for the AXL Mesh Proof Panel.
 *
 * For each configured node it does two things:
 *  - probes the AXL daemon's /topology endpoint (pubkey, IPv6, peers)
 *  - reads SynodRegistry.settlers(evmAddress) for on-chain registration
 *
 * Returns a single NetworkView consumed by /api/network and /network.
 */

import { createPublicClient, http, type Hex } from "viem";

import { resolveEnsView, type SynodEnsSubname } from "./ens";
import { loadConfig } from "./registry";
import { SYNOD_REGISTRY_ABI } from "./registry-abi";

export type NodeSpec = {
  name: string;
  axlApi: string;
  evmAddress: string;
  /** ENS subname this spec was sourced from, e.g. "settler-a.synodai.eth". */
  ensFqn?: string;
  /** Role string from the subname's `synod.role` text record. */
  ensRole?: string;
  /** ed25519 pubkey from the subname's `synod.pubkey` text record. */
  ensPubkey?: string;
};

export type AxlPeer = {
  uri: string;
  up: boolean;
  inbound: boolean;
};

export type NodeView = {
  spec: NodeSpec;
  online: boolean;
  pubkey?: string;
  ipv6?: string;
  peers: AxlPeer[];
  registered: boolean;
  registeredAxlPubKey?: string;
  registeredModelTag?: string;
  pubkeyMatchesRegistry: boolean;
  /** True when the live AXL pubkey matches the `synod.pubkey` text record in ENS. */
  pubkeyMatchesEns?: boolean;
};

export type MeshEdge = {
  from: string; // node name
  to: string;
  bidirectional: boolean;
  up: boolean;
};

export type NetworkView = {
  registryAddress?: string;
  chainId?: number;
  registeredSettlerCount?: number;
  nodes: NodeView[];
  edges: MeshEdge[];
  serverTimeMs: number;
  /** Where registry/RPC + settler list came from this tick. "ens" = synodai.eth records. */
  configSource?: "ens" | "env" | "runtime-json";
  /** Parent ENS name when configSource === "ens". */
  ensParent?: string;
  /** Number of subnames resolved from ENS (0 if no ENS). */
  ensSubnameCount?: number;
};

const DEFAULT_NODES: NodeSpec[] = [
  {
    name: "A",
    axlApi: "http://127.0.0.1:9002",
    evmAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  },
  {
    name: "B",
    axlApi: "http://127.0.0.1:9012",
    evmAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  },
  {
    name: "C",
    axlApi: "http://127.0.0.1:9022",
    evmAddress: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  },
];

/**
 * Maps ENS subnames to their AXL daemon URL. ENS holds *who* the settler is
 * (EVM address, role, pubkey); this map holds *where* to reach it. Override
 * via SYNOD_UI_AXL_MAP=settler-a.synodai.eth=http://...,settler-b...=...
 */
const DEFAULT_AXL_MAP: Record<string, string> = {
  "settler-a.synodai.eth": "http://127.0.0.1:9002",
  "settler-b.synodai.eth": "http://127.0.0.1:9012",
  "settler-c.synodai.eth": "http://127.0.0.1:9022",
  // Settler D runs on a separate machine (Servarica). The UI server (Contabo)
  // probes its /topology through a socat bridge on port 9203 → 127.0.0.1:9202;
  // the bridge is firewalled to Contabo's IP only. Keeps D's API private while
  // letting the cross-stack ENS+chain+live cross-check work end-to-end.
  "settler-d.synodai.eth": "http://38.49.212.102:9203",
};

function loadAxlMap(): Record<string, string> {
  const raw = process.env.SYNOD_UI_AXL_MAP;
  if (!raw) return DEFAULT_AXL_MAP;
  const out: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    const [k, v] = entry.split("=").map((s) => s.trim());
    if (k && v) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : DEFAULT_AXL_MAP;
}

function specFromSubname(s: SynodEnsSubname, axlApi: string): NodeSpec {
  // Display name: "A" / "B" / "C" from "settler-a" / "settler-b" / "settler-c"
  const tail = s.label.replace(/^settler-/, "").toUpperCase() || s.label.toUpperCase();
  return {
    name: tail,
    axlApi,
    evmAddress: s.evmAddress,
    ensFqn: s.fqn,
    ensRole: s.role,
    ensPubkey: s.pubkey,
  };
}

/**
 * Source the canonical settler list. ENS subnames win when present; env JSON
 * is an explicit override; hardcoded defaults are local-dev fallback.
 */
export async function loadNetworkNodes(): Promise<{
  specs: NodeSpec[];
  source: "ens" | "env" | "default";
}> {
  if (process.env.SYNOD_UI_DISABLE_ENS !== "1") {
    try {
      const ens = await resolveEnsView();
      if (ens.subnames.length > 0) {
        const map = loadAxlMap();
        const specs = ens.subnames.map((s) =>
          specFromSubname(s, map[s.fqn] ?? `http://127.0.0.1:9002`)
        );
        return { specs, source: "ens" };
      }
    } catch {
      // fall through
    }
  }

  const raw = process.env.SYNOD_UI_NETWORK_NODES;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as NodeSpec[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { specs: parsed, source: "env" };
      }
    } catch {
      // fall through
    }
  }
  return { specs: DEFAULT_NODES, source: "default" };
}

async function probeAxl(
  spec: NodeSpec
): Promise<Pick<NodeView, "online" | "pubkey" | "ipv6" | "peers">> {
  try {
    const res = await fetch(`${spec.axlApi}/topology`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { online: false, peers: [] };
    const j = (await res.json()) as {
      our_public_key?: string;
      our_ipv6?: string;
      peers?: AxlPeer[];
    };
    return {
      online: true,
      pubkey: j.our_public_key,
      ipv6: j.our_ipv6,
      peers: Array.isArray(j.peers) ? j.peers : [],
    };
  } catch {
    return { online: false, peers: [] };
  }
}

function deriveEdges(nodes: NodeView[]): MeshEdge[] {
  // Each node reports peers by URI (e.g. "tls://127.0.0.1:9001"). We can't
  // map URI back to node name without more info, but for the canonical local
  // 3-node demo we know A listens on 9001 and B/C dial out to A. So edge
  // detection here is best-effort: a peer connection where any node has at
  // least one peer up implies that node is in the mesh.
  const edges: MeshEdge[] = [];
  const peerCount = (n: NodeView): number => n.peers.filter((p) => p.up).length;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (!a.online || !b.online) continue;
      // If both have at least one up peer, infer they're meshed (A is the
      // common hub). For a fuller graph we'd correlate URIs; this is enough
      // to show "the mesh is real" on the panel.
      if (peerCount(a) > 0 && peerCount(b) > 0) {
        edges.push({ from: a.spec.name, to: b.spec.name, bidirectional: true, up: true });
      }
    }
  }
  return edges;
}

export async function gatherNetworkState(): Promise<NetworkView> {
  const [cfg, nodes] = await Promise.all([loadConfig(), loadNetworkNodes()]);
  const specs = nodes.specs;

  // 1. Probe all AXL daemons in parallel
  const probes = await Promise.all(
    specs.map(async (spec) => ({
      spec,
      ...(await probeAxl(spec)),
    }))
  );

  const out: NetworkView = {
    nodes: probes.map((p) => {
      const ensPubkey = p.spec.ensPubkey;
      const ensMatches =
        ensPubkey !== undefined && p.pubkey !== undefined
          ? p.pubkey.toLowerCase() === ensPubkey.toLowerCase()
          : undefined;
      return {
        spec: p.spec,
        online: p.online,
        pubkey: p.pubkey,
        ipv6: p.ipv6,
        peers: p.peers,
        registered: false,
        pubkeyMatchesRegistry: false,
        pubkeyMatchesEns: ensMatches,
      };
    }),
    edges: [],
    serverTimeMs: Date.now(),
    configSource: cfg?.source,
    ensParent: nodes.source === "ens" ? "synodai.eth" : undefined,
    ensSubnameCount: nodes.source === "ens" ? specs.length : 0,
  };

  // 2. Read on-chain registration for each node
  if (cfg) {
    out.registryAddress = cfg.registryAddress;
    out.chainId = cfg.chainId;
    const client = createPublicClient({ transport: http(cfg.rpcUrl) });
    try {
      out.chainId = await client.getChainId();
    } catch {
      // RPC offline — fall through with whatever AXL data we have
    }
    if (out.chainId !== undefined) {
      try {
        const count = await client.readContract({
          address: cfg.registryAddress as Hex,
          abi: SYNOD_REGISTRY_ABI,
          functionName: "registeredSettlerCount",
        });
        out.registeredSettlerCount = Number(count);
      } catch {
        // registry not deployed — return what we have
        out.edges = deriveEdges(out.nodes);
        return out;
      }

      await Promise.all(
        out.nodes.map(async (node) => {
          try {
            const tuple = (await client.readContract({
              address: cfg.registryAddress as Hex,
              abi: SYNOD_REGISTRY_ABI,
              functionName: "settlers",
              args: [node.spec.evmAddress as Hex],
            })) as [boolean, string, string, bigint];
            const [registered, axlPubKey, modelTag] = tuple;
            node.registered = registered;
            node.registeredAxlPubKey =
              typeof axlPubKey === "string" && axlPubKey.startsWith("0x")
                ? axlPubKey.slice(2)
                : axlPubKey;
            node.registeredModelTag = modelTag;
            node.pubkeyMatchesRegistry =
              !!node.pubkey &&
              !!node.registeredAxlPubKey &&
              node.pubkey.toLowerCase() === node.registeredAxlPubKey.toLowerCase();
          } catch {
            // single-node failure shouldn't break the panel
          }
        })
      );
    }
  }

  out.edges = deriveEdges(out.nodes);
  return out;
}
