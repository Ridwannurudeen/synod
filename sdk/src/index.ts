/**
 * @synod/sdk — thin TypeScript SDK for the Synod public API.
 *
 * Wraps the live HTTP endpoints at synod.gudman.xyz (configurable). Pure
 * fetch + types — no chain RPC or Ethers/Viem dependency, so it loads in
 * any runtime that has fetch (Node 18+, browsers, Bun, Deno, edge).
 *
 * Quick start:
 *
 *   import { SynodClient } from '@synod/sdk';
 *   const synod = new SynodClient();
 *   const proof = await synod.verify('0x4320bedd…');
 *   if (proof.status === 'verified') console.log('settled outcome:', proof.onchain?.outcome);
 *
 * For the full schema of each return type see types below or the live API:
 * https://synod.gudman.xyz/api/<endpoint>
 */

export const DEFAULT_BASE_URL = "https://synod.gudman.xyz";

export interface ClientOptions {
  /** Base URL of a Synod deployment. Defaults to the canonical mainnet. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default 10000. */
  timeoutMs?: number;
  /** Custom fetch implementation. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export type ConfigSource = "ens" | "env" | "runtime-json";

export interface SynodEnsView {
  source: "ens" | "fallback";
  parent?: {
    parent: string;
    registryAddress: string;
    chainId: number;
    rpcUrl: string;
    threshold: number;
    url?: string;
    description?: string;
    github?: string;
  };
  subnames: Array<{
    fqn: string;
    label: string;
    evmAddress: string;
    role: string;
    pubkey: string;
    parent: string;
  }>;
  resolvedAtMs: number;
  ensRpcUrl: string;
}

export interface SynodAgentProfile {
  ensName: string;
  addr: string;
  role: string;
  pubkey: string;
  parent: string;
  registry: {
    address: string;
    registered: boolean;
    axlPubKey?: string;
    modelTag?: string;
    pubkeyMatchesEns?: boolean;
  } | null;
  live: {
    online: boolean;
    ipv6?: string;
    peerCount?: number;
  };
  agreement?: {
    totalAppearances: number;
    agreedWithConsensus: number;
    agreementRate: number | null;
    sampleSize: string;
  } | null;
  lookupTimeMs: number;
}

export interface SynodVote {
  pubkey: string;
  modelTag?: string;
  outcome?: number;
  confidence?: number;
  signatureValid: boolean;
  registered: boolean;
}

export interface SynodProof {
  status: "verified" | "invalid" | "unavailable";
  errors: string[];
  votes: SynodVote[];
  questionId?: string;
  registryAddress?: string;
  chainId?: number;
  winnerVotes?: number;
  weightedScoreScaled?: number;
  onchain?: {
    outcome: number;
    quorumSize: number;
    weightedScoreScaled: number;
    postedBy: string;
    timestamp: number;
  };
}

export interface SynodTranscript {
  questionId: string;
  root: string;
  tx: string;
  indexerUrl: string;
  bytes: number;
  uploadedAt: number;
  storage: string;
  storageScanUrl: string;
}

export interface SynodJudgment {
  questionId: string;
  fqn: string;
  label: string;
  subnode: string;
  owner: string;
  mintTx: string;
  recordsTx: string;
  ensAppUrl: string;
  textRecords: Record<string, string>;
  etherscanMintUrl: string;
  etherscanRecordsUrl: string;
}

export interface SynodGalleryItem {
  questionId: string;
  prompt: string;
  outcome: number | null;
  outcomeLabel: string;
  postedAt: number;
  transcript: { root: string; indexerUrl: string; bytes: number };
  judgment: { fqn: string; ensAppUrl: string } | null;
}

export interface SynodGalleryView {
  count: number;
  items: SynodGalleryItem[];
  serverTimeMs: number;
}

export interface SynodStats {
  questionsSettled: number;
  judgmentsMinted: number;
  transcriptsKB: number;
  transcriptsBytes: number;
  registeredSettlerCount?: number;
  registryAddress?: string;
  chainId?: number;
  storageNetwork: string;
  ensParent: string;
  serverTimeMs: number;
}

export interface SynodInftToken {
  name: string;
  fqn: string;
  role: string;
  owner: string;
  tokenId: number;
  dataHash: string;
  description: string;
  tx: string;
  explorer: string;
}

export interface SynodInftView {
  contract: string;
  verifier: string;
  chain: string;
  chainId: number;
  explorer_contract: string;
  standard: string;
  scope_note: string;
  tokens: SynodInftToken[];
  transfers?: Array<{
    tokenId: number;
    from: string;
    to: string;
    tx: string;
    explorer: string;
  }>;
}

/** Custom error class so callers can switch on this vs other Errors. */
export class SynodAPIError extends Error {
  status: number;
  endpoint: string;
  body: unknown;
  constructor(status: number, endpoint: string, body: unknown, message?: string) {
    super(message ?? `Synod API error ${status} at ${endpoint}`);
    this.name = "SynodAPIError";
    this.status = status;
    this.endpoint = endpoint;
    this.body = body;
  }
}

export class SynodClient {
  private baseUrl: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error(
        "@synod/sdk requires a fetch implementation. Pass one via ClientOptions.fetchImpl on Node <18."
      );
    }
  }

  /** Resolve an ENS-named Synod agent. Returns null on 404. */
  async agent(ensName: string): Promise<SynodAgentProfile | null> {
    const fqn = ensName.toLowerCase();
    return this.get<SynodAgentProfile>(`/api/agent/${encodeURIComponent(fqn)}`);
  }

  /** Verify a proof for a settled question by id (32-byte hex, with or without 0x). */
  async verify(questionId: string): Promise<SynodProof> {
    const qid = questionId.startsWith("0x") ? questionId : `0x${questionId}`;
    const res = await this.request("POST", "/api/verify-proof", { questionId: qid });
    return res as SynodProof;
  }

  /** Fetch the 0G Storage transcript pointer for a settled question. Returns null on 404. */
  async transcript(questionId: string): Promise<SynodTranscript | null> {
    const qid = questionId.toLowerCase().replace(/^0x/, "");
    return this.get<SynodTranscript>(`/api/transcript/${qid}`);
  }

  /** Fetch the ENS judgment subname for a settled question. Returns null on 404. */
  async judgment(questionId: string): Promise<SynodJudgment | null> {
    const qid = questionId.toLowerCase().replace(/^0x/, "");
    return this.get<SynodJudgment>(`/api/judgment/${qid}`);
  }

  /** Browse all settled questions (most-recent first). */
  async gallery(): Promise<SynodGalleryView> {
    const res = await this.get<SynodGalleryView>("/api/gallery");
    if (!res) throw new SynodAPIError(500, "/api/gallery", null, "gallery endpoint returned no body");
    return res;
  }

  /** Live protocol counters (questionsSettled, judgmentsMinted, transcriptsKB, ...). */
  async stats(): Promise<SynodStats> {
    const res = await this.get<SynodStats>("/api/stats");
    if (!res) throw new SynodAPIError(500, "/api/stats", null, "stats endpoint returned no body");
    return res;
  }

  /** ENS bootloader resolution — registry address, RPC, threshold, settler list. */
  async ens(refresh = false): Promise<SynodEnsView> {
    const path = refresh ? "/api/ens?refresh=1" : "/api/ens";
    const res = await this.get<SynodEnsView>(path);
    if (!res) throw new SynodAPIError(500, path, null, "ens endpoint returned no body");
    return res;
  }

  /** ERC-7857 iNFT mint + transfer record on 0G Galileo. */
  async inft(): Promise<SynodInftView | null> {
    return this.get<SynodInftView>("/api/inft");
  }

  // ----- internal -----

  private async get<T>(path: string): Promise<T | null> {
    const res = await this.rawFetch(path, "GET");
    if (res.status === 404) return null;
    if (!res.ok) throw new SynodAPIError(res.status, path, await res.text());
    return (await res.json()) as T;
  }

  private async request(method: string, path: string, body: unknown): Promise<unknown> {
    const res = await this.rawFetch(path, method, body);
    if (!res.ok) throw new SynodAPIError(res.status, path, await res.text());
    return await res.json();
  }

  private async rawFetch(path: string, method: string, body?: unknown): Promise<Response> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(t);
    }
  }
}

/** Convenience: client pinned to the canonical mainnet deployment. */
export const synod = new SynodClient();
