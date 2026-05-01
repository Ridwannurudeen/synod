# Feedback — 0G

Honest engineering feedback from integrating 0G Storage into Synod during ETHGlobal Open Agents 2026. We persist every full deliberation transcript (per-settler reasoning + signed votes + outcome) to 0G Storage Galileo testnet. 14+ transcripts uploaded so far, all retrievable from anywhere via the public indexer URL.

## What worked exceptionally

- **The HTTP indexer's `?root=0x…` retrieval is the killer feature.** No SDK, no auth, no client install — `curl https://indexer-storage-testnet-turbo.0g.ai/file?root=0x…` from any host returns the bytes. This is what made 0G a slot-in for our "every consensus event leaves a verifiable record" narrative. We surface this URL directly in our /verify UI.
- **The `0g-storage-client` Go binary** (built from `github.com/0glabs/0g-storage-client`) works reliably for upload. Once we found the right invocation, our settler-side persistence flow was a 60-line Python wrapper around `subprocess.run([...])`.
- **0G Chain on-chain tx confirmation** for log entries is fast (~1-2 sec on Galileo). Storage uploads usually complete in under 6 seconds end-to-end including merkleization, on-chain submission, and indexer confirmation.

## Friction we hit

### 1. The TypeScript SDK fails to initialize the indexer client

We initially tried `@0glabs/0g-ts-sdk` for transcript persistence. On a fresh setup (Galileo testnet, indexer-storage-testnet-turbo.0g.ai endpoint), the indexer client init throws:

```
Error: could not decode result data
  ... call: market()
  ... contract: <market contract address>
```

This appeared during ledger / market lookup before any actual upload. We debugged for ~90 minutes before pivoting to the Go CLI binary, which Just Worked.

**Suggestion**: a one-line note in the SDK README — "if you hit market-contract decode errors, the Go CLI is the canonical path on Galileo right now" — would have saved real time.

### 2. The indexer endpoint URL isn't documented in the obvious places

The CLI takes `--indexer <url>`, but the actual URL (`https://indexer-storage-testnet-turbo.0g.ai`) isn't in the storage-cli docs page or the testnet-overview page. We found it by searching across third-party blog posts. Adding it to the testnet overview alongside the EVM RPC would help.

### 3. Faucet daily cap is restrictive for testing

`faucet.0g.ai` caps at 0.1 0G/day per address. For a development cycle that involves many uploads, this is tight — each upload costs neuron in gas + a Storage market submission. We worked around it by using one funded wallet, but for a hackathon multi-day build, a dev-mode faucet with higher caps (or a separate "deploy / build" faucet) would help.

### 4. CLI `--no-commit` flag was accepted earlier, removed silently

When wiring up CI, we used `forge install --no-commit` (separate Foundry context) and got a "unknown argument" error from a recent CLI version. Same pattern *could* affect the Go storage-client — pin command flags in docs to specific binary versions.

## What we'd love to see

- **A standalone HTTP `POST /upload` endpoint** on the indexer, mirroring the GET retrieval endpoint. Right now upload requires Go + private-key + on-chain tx. A simple HTTP gateway (key-on-server, rate-limited) would unlock browser-side upload flows.
- **Storage Scan permalinks** that resolve `?root=…` directly to a viewer/explorer page. Currently the explorer is at `storagescan-galileo.0g.ai` but linking to a specific root requires knowing the txSeq.
- **A "minimal-deps" Python SDK** — Go + JS SDKs are great but lots of agent code lives in Python. A wrapper that doesn't pull in the full ledger/market complexity (just upload + retrieve) would cover 80% of usage.

## How we use 0G in Synod

After every successful on-chain settlement on Gensyn L2, the designated poster runs:

```bash
0g-storage-client upload \
  --url https://evmrpc-testnet.0g.ai \
  --indexer https://indexer-storage-testnet-turbo.0g.ai \
  --key $SYNOD_0G_KEY \
  --file transcript.json
```

The returned root hash gets:
1. saved to `runtime/transcripts.json` for the UI
2. minted into the judgment ENS subname's `synod.transcript-cid` text record on Ethereum mainnet

So 0G Storage is the canonical "shared memory" for the swarm, anchored on Gensyn L2 (settlement) and Ethereum mainnet (judgment NFT). Three chains, one record, all queryable.

## Live: https://synod.gudman.xyz/gallery

Click any settled question, then "fetch raw transcript →" — that round-trips through your public indexer.

Genuinely good infrastructure. The HTTP retrieval endpoint is the exact right move for AI agent memory layers — we'd not have used 0G Storage if we had to make every reader install a SDK.
