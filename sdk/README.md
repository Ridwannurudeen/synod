# @synod/sdk

Thin TypeScript SDK for [Synod](https://synod.gudman.xyz) — AI Receipts. Verify proofs, look up settlers, browse gallery, fetch transcripts and judgments. Works in any runtime with `fetch` (Node 18+, browsers, Bun, Deno, edge).

## Install

```bash
npm install @synod/sdk
```

## Quickstart

```ts
import { synod } from "@synod/sdk";

// Live protocol counters
const stats = await synod.stats();
console.log(`${stats.questionsSettled} settled · ${stats.judgmentsMinted} judgments`);

// Resolve a settler by ENS name
const a = await synod.agent("settler-a.synodai.eth");
console.log(a?.role, "agreement:", a?.agreement?.agreementRate);

// Verify a proof end-to-end (recomputed from raw chain bytes)
const proof = await synod.verify("0xcd79b5dbfc6365f7…7ac");
if (proof.status === "verified") {
  console.log("settled outcome:", proof.onchain?.outcome);
  console.log("verified votes:", proof.votes.length);
}

// Browse all settled questions
const gallery = await synod.gallery();
for (const item of gallery.items.slice(0, 5)) {
  console.log(item.outcomeLabel, "·", item.prompt.slice(0, 60));
}

// Fetch the 0G Storage transcript pointer
const t = await synod.transcript("0xcd79b5db…");
console.log("transcript on 0G:", t?.indexerUrl);

// Look up an ENS judgment subname
const j = await synod.judgment("0xcd79b5db…");
console.log("judgment NFT:", j?.fqn, "owned by", j?.owner);

// ENS bootloader resolution (registry, RPC, threshold, settler list)
const ens = await synod.ens();
console.log(ens.source === "ens" ? "ENS-sourced" : "fallback");

// ERC-7857 iNFT mints + transfers on 0G Galileo
const inft = await synod.inft();
console.log(inft?.tokens.length, "iNFTs minted on", inft?.chain);
```

## Custom deployments

```ts
import { SynodClient } from "@synod/sdk";

const localSynod = new SynodClient({
  baseUrl: "http://localhost:3000",
  timeoutMs: 5000,
});
```

## API

| Method | Path | Returns |
|---|---|---|
| `synod.stats()` | `/api/stats` | live counters |
| `synod.ens(refresh?)` | `/api/ens` | bootloader resolution |
| `synod.agent(ensName)` | `/api/agent/{name}` | settler profile + agreement stats |
| `synod.gallery()` | `/api/gallery` | all settled questions |
| `synod.verify(qid)` | `POST /api/verify-proof` | recomputed proof (status, votes, errors) |
| `synod.transcript(qid)` | `/api/transcript/{qid}` | 0G Storage pointer |
| `synod.judgment(qid)` | `/api/judgment/{qid}` | ENS judgment subname |
| `synod.inft()` | `/api/inft` | iNFT mint + transfer record |

`null` is returned for 404s on lookup methods. Other non-2xx responses throw a `SynodAPIError` with `.status`, `.endpoint`, and `.body`.

## Errors

```ts
import { SynodAPIError } from "@synod/sdk";

try {
  await synod.verify("0xnotahex");
} catch (e) {
  if (e instanceof SynodAPIError) {
    console.error("Synod API said no:", e.status, e.endpoint);
  } else {
    throw e;
  }
}
```

## What this SDK is not

- Not a chain client. We don't read directly from Gensyn L2 / Ethereum / 0G Chain. We hit the Synod HTTP API which composes those for you. If you need raw chain access, use [viem](https://viem.sh) or [ethers](https://docs.ethers.org).
- Not a settler / agent runner. To run a settler, see the Python `synod_settler` package in the main repo.
- Not the canonical proof verifier. The proof verifier is shipped both as a Python CLI (`tools/verify_settlement.py`) and as a server-side endpoint that the SDK wraps. Both produce identical results from raw chain bytes.

## Live deployment

- UI: https://synod.gudman.xyz
- Source: https://github.com/Ridwannurudeen/synod
- ENS parent: synodai.eth
- iNFT contract on 0G Galileo: [`0x4fF6712B…2D85`](https://chainscan-galileo.0g.ai/address/0x4fF6712B364A06f4f23878dE3c4678E8F48f2D85)

MIT licensed. Built during ETHGlobal Open Agents 2026.
