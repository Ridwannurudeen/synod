# [Bug / Docs] JS/Python SDK indexer-client init fails on Galileo — `could not decode result data` from market contract

## Repro

While integrating 0G Storage for transcript persistence during ETHGlobal Open Agents 2026 (target: 0G Track 2 Swarms prize), the TypeScript SDK fails to initialize an indexer client against the public Galileo testnet endpoint.

Approximate setup:

```ts
import { Indexer } from "@0glabs/0g-ts-sdk";

const indexer = new Indexer("https://indexer-storage-testnet-turbo.0g.ai");
// ↑ this throws during ledger / market lookup
```

Error (paraphrased — exact stack trace not preserved in our build logs, but the error string is verbatim):

```
Error: could not decode result data
  call: market()
  contract: <market contract address on 0G Chain>
```

Same shape on the Python SDK at the equivalent ledger-init step.

## Environment

- 0G Chain Galileo testnet (chain id 16602)
- EVM RPC: `https://evmrpc-testnet.0g.ai`
- Indexer endpoint: `https://indexer-storage-testnet-turbo.0g.ai`
- Wallet had 0.448 OG at the time of the call (sufficient for the call's gas)
- Date encountered: late April 2026

## Workaround that worked

Switched from the SDK to the Go CLI binary built from `github.com/0glabs/0g-storage-client` (`eip-7857-draft`-era main branch). The CLI works flawlessly:

```bash
0g-storage-client upload \
  --url https://evmrpc-testnet.0g.ai \
  --indexer https://indexer-storage-testnet-turbo.0g.ai \
  --key $PRIVATE_KEY_HEX_NO_PREFIX \
  --file transcript.json
```

Returns a 32-byte merkle root. Subsequent retrieval via pure HTTP is even simpler:

```bash
curl "https://indexer-storage-testnet-turbo.0g.ai/file?root=0x{merkleRoot}"
```

This is now our production path for Synod (~14 transcripts persisted to date, all retrievable end-to-end).

## Suggested fix or doc improvement

- Either fix the SDK's market-contract decode path against the live Galileo deployment, or
- Add a bold note at the top of the SDK README: *"On Galileo, the canonical client is the Go CLI binary; the JS/Python SDKs may fail at ledger init. Use the CLI + HTTP indexer for production paths."*

Even just that note would have saved us ~90 minutes of debugging. The CLI itself is great — strongly recommend leading with it in the docs.

## Adjacent doc gap

The actual indexer endpoint URL (`https://indexer-storage-testnet-turbo.0g.ai`) is referenced in the CLI args but isn't in the [storage-cli docs page](https://docs.0g.ai/developer-hub/building-on-0g/storage/storage-cli) or the [testnet-overview](https://docs.0g.ai/developer-hub/testnet/testnet-overview). We found it by searching third-party sources. Adding it to the testnet-overview alongside the EVM RPC + storage smart contracts would close the loop.

## Why we hit this

We're using 0G Storage as the canonical transcript memory for a multi-model AI consensus protocol. Every settlement on a separate L2 (Gensyn) writes its full deliberation transcript to 0G Storage; the merkle root is then minted into an ENS subname on Ethereum mainnet as a transferable judgment NFT. Three chains, one record. The HTTP retrieval URL is exactly the right primitive for AI agent memory — happy to provide more detail if useful.

Live: [synod.gudman.xyz/gallery](https://synod.gudman.xyz/gallery) — click any settled question, then "fetch raw transcript →".

Filed in the spirit of paying it forward to the next builder.
