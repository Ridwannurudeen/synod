# Synod

[![CI](https://github.com/Ridwannurudeen/synod/actions/workflows/ci.yml/badge.svg)](https://github.com/Ridwannurudeen/synod/actions/workflows/ci.yml)
[![ETHGlobal Open Agents](https://img.shields.io/badge/ETHGlobal-Open%20Agents%202026-blue)](https://ethglobal.com/events/openagents)
[![Live demo](https://img.shields.io/badge/live-synod.gudman.xyz-00e5a0)](https://synod.gudman.xyz)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

> **AXL-native signed consensus receipts for AI settlement.** Multi-model AI agents communicate over Gensyn AXL, sign votes with ed25519, anchor settlements on Gensyn L2, and publish ENS-addressable + 0G-stored receipts that anyone can independently verify off-chain. ETHGlobal Open Agents (May 2026) — partner submissions to **Gensyn AXL**, **ENS** (Identity + Creative tracks), and **0G** (Track 2 Swarms).

When one AI calls the outcome, you trust one company. With Synod, you trust a network — and the network leaves a cryptographically anchored receipt every time it speaks.

**Scope (v1):** the chain *anchors* the signed-vote bundle and the registered-poster identity. Quorum arithmetic, signature validity, and per-outcome quorum membership are **independently verified off-chain** by the public verifier (TypeScript at `ui/lib/proof-verifier.ts`, Python CLI at `settler/tools/verify_settlement.py`). On-chain enforcement of quorum (EIP-712 + per-block registry snapshots) is a v1.1 design captured in `ROADMAP.md`. See [§ Scope boundary — v1 vs v1.1](#scope-boundary--v1-vs-v11) below.

**Live**: [synod.gudman.xyz](https://synod.gudman.xyz). Try in 5 seconds:

```bash
# Resolve a settler
curl -s https://synod.gudman.xyz/api/agent/settler-a.synodai.eth | jq

# Verify a real settled proof end-to-end
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"questionId":"0xcd79b5dbfc6365f7f6c21e5b1c7a7b841a502b448fe9689f403d84fbac4447ac"}' \
  https://synod.gudman.xyz/api/verify-proof | jq '.status, .votes | length'

# Or use the SDK (TypeScript, hits the live API)
npm i github:Ridwannurudeen/synod#main --save  # SDK is at sdk/ in the repo
```

The package is named `@synod/sdk` and lives in `sdk/`. It is intentionally **unpublished on npm during the hackathon** — install directly from the GitHub repo. `cd sdk && npm test` runs 9 smoke tests against the live deployment.

## What's actually shipped (verifiable on-chain)

| Layer | Where | What |
|---|---|---|
| Settlement | Gensyn L2 mainnet | [`SynodRegistry @ 0xD387…b6ad`](https://gensyn-mainnet.explorer.alchemy.com/address/0xD387f749667590940d7c68CA350e57FbcE62b6ad) — 50+ `SettlementRecorded` events on chain, payload bytes anchored verbatim, every vote ed25519-signed and independently verifiable off-chain |
| Identity | Ethereum mainnet ENS | [`synodai.eth`](https://app.ens.domains/synodai.eth) is load-bearing — registry/RPC/threshold/settler list all in text records. `settler-{a,b,c,d}` subnames cross-checked. |
| Memory | 0G Storage Galileo | Every transcript persisted; pure HTTP retrieval at `https://indexer-storage-testnet-turbo.0g.ai/file?root=0x…` |
| Receipts | Ethereum mainnet ENS | `j-{hash}.synodai.eth` minted per settlement — transferable AI judgment NFT |
| Agent NFTs | 0G Galileo | [`AgentNFT @ 0x4fF6712B…2D85`](https://chainscan-galileo.0g.ai/address/0x4fF6712B364A06f4f23878dE3c4678E8F48f2D85) — 4 ERC-7857 iNFTs minted (token IDs 0-3), 1 transferred on-chain to prove the spec works |
| Cross-machine | Frankfurt + Toronto VPS | AXL Yggdrasil mesh, bidirectional public-IP peer, no central coordinator |

## How each partner's tech is load-bearing

| Layer | Role | Demo lever |
| --- | --- | --- |
| **Gensyn AXL** | The only inter-settler transport. End-to-end encrypted Yggdrasil mesh. Cross-machine: Settlers A/B/C on Frankfurt VPS, Settler D on Toronto VPS. | `curl /topology` from both boxes shows bidirectional peer over public IP. |
| **ENS (`synodai.eth`)** | Bootloader for the entire stack — registry contract address, RPC URL, chain id, threshold, settler list, all in on-chain text records. Edit a record → UI swings. | `GET https://synod.gudman.xyz/api/ens` returns live resolution. |
| **ENS subnames** | Each settler is `settler-{a,b,c,d}.synodai.eth` with addr + role + ed25519 pubkey, cross-checked against on-chain registry AND live AXL daemon. | `GET /api/agent/settler-a.synodai.eth` |
| **ENS judgment subnames** | After every settlement, a `j-{hash}.synodai.eth` is mintable to the question submitter — transferable AI judgment NFT. | See [`docs/ENSIP-DRAFT-AI-AGENT-IDENTITY.md`](docs/ENSIP-DRAFT-AI-AGENT-IDENTITY.md) |
| **0G Storage** | Decentralized memory — every full deliberation transcript persisted via 0G Storage CLI; retrievable from anywhere via pure HTTP indexer URL. | `curl https://indexer-storage-testnet-turbo.0g.ai/file?root=0x…` |
| **0G Chain (ERC-7857)** | Each settler minted as an iNFT on 0G Galileo (chain 16602) using 0G Labs' own reference contract. Token IDs 0-3, owner = settler EVM address. | [`0x4fF6712B…2D85`](https://chainscan-galileo.0g.ai/address/0x4fF6712B364A06f4f23878dE3c4678E8F48f2D85) |
| **Gensyn L2 (chain 685689)** | The canonical settlement record. SynodRegistry at [`0xD387f749…b6ad`](https://gensyn-mainnet.explorer.alchemy.com/address/0xD387f749667590940d7c68CA350e57FbcE62b6ad). | First mainnet settlement: tx `0xc96835…6ab8b82` |

See [`QUICKSTART.md`](QUICKSTART.md) for `make demo` (local fork-and-run), [`sdk/README.md`](sdk/README.md) for the TypeScript SDK, [`docs/SUBMISSIONS.md`](docs/SUBMISSIONS.md) for the per-track ETHGlobal writeup, [`docs/COMPARISON.md`](docs/COMPARISON.md) for Synod vs Chainlink/UMA/Pyth/Reality.eth/Bittensor, [`docs/DEMO_THEATER.md`](docs/DEMO_THEATER.md) for the demo video script, and [`docs/grant-security-model.md`](docs/grant-security-model.md) for the grant-honest security model.

## The problem

Gensyn launched [Delphi](https://blog.gensyn.ai/delphi/) on mainnet on April 22, 2026 — *AI-settled information markets* on the Gensyn L2 (chain id `685689`). At market creation, the creator picks one or more AI models to act as the settlement oracle, and the model weights are fixed for that market's lifetime ([source](https://docs.gensyn.ai/tech/delphi-sdk/methods)).

That's a single point of trust. Pick a biased or hallucinating model, and the market resolves wrong with no recourse. Other prediction markets solved this with decentralized human oracles (UMA, REP). **Delphi has no decentralized AI oracle today.**

Synod is the missing piece.

## What Synod does

A network of heterogeneous AI settler nodes, each running a different model provider (Anthropic, OpenAI, Gemini, or future open-source adapters), independently runs inference on a market resolution prompt, signs the answer with its [Gensyn AXL](https://docs.gensyn.ai/tech/agent-exchange-layer) ed25519 identity key, exchanges signed votes over AXL's encrypted P2P mesh, computes quorum-gated confidence-weighted consensus, and posts the signed-vote proof on-chain to `SynodRegistry` on Gensyn L2.

The registry anchors the full bundle of signed votes as raw bytes and exposes registered AXL pubkeys. **Anyone** can re-verify the proof off-chain by reconstructing each vote's canonical-JSON signing payload, checking the ed25519 signature against the settler's registered AXL pubkey, and recomputing the winner quorum and weighted score. The live UI performs this verification server-side and shows the result.

## Architecture

```
                          ┌──────────────────────────────┐
                          │   1. Question announcement    │
                          │   (creator → primary node)    │
                          └──────────────┬───────────────┘
                                         │ AXL P2P
              ┌──────────────────────────┴────────────────────────────┐
              ▼                          ▼                            ▼
   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
   │  Settler A       │    │  Settler B       │    │  Settler N       │
   │  Sonnet 4.6      │    │  Haiku 4.5       │    │  Gemini / Opus   │
   │  AXL ed25519 id  │    │  AXL ed25519 id  │    │  AXL ed25519 id  │
   │  EVM signer      │    │  EVM signer      │    │  EVM signer      │
   └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
            │                       │                       │
            │   2. Independent inference + signed vote      │
            │                       │                       │
            └─────────── AXL P2P encrypted broadcast ───────┘
                                    │
                                    │  3. Confidence-weighted consensus
                                    │
                                    ▼
                  ┌─────────────────────────────────┐
                  │  4. Designated poster (lowest    │
                  │     pubkey) submits to chain     │
                  └────────────────┬────────────────┘
                                   ▼
                  ┌─────────────────────────────────┐
                  │   SynodRegistry @ Gensyn L2      │
                  │   recordSettlement(qid, outcome, │
                  │     quorum, score, signedVotes)  │
                  └─────────────────────────────────┘
```

| Layer | Implementation |
|---|---|
| P2P transport | [Gensyn AXL](https://github.com/gensyn-ai/axl) — Yggdrasil mesh, ed25519 keys, end-to-end encryption |
| Settler agents | Python 3.11+, Anthropic SDK, ed25519 sign via `cryptography` |
| Consensus | Confidence-weighted majority with deterministic tie-break, dedup-by-settler |
| On-chain | Solidity 0.8.24, Foundry, web3.py 7.x, OP Stack-compatible |
| Live viewer | Next.js 16 + Tailwind + viem |

## What's working today

- ✅ AXL multi-node mesh (local + VPS, encrypted P2P, cross-machine round-trip)
- ✅ Settler agent (LLM inference + ed25519 vote signing + AXL broadcast + consensus)
- ✅ On-chain proof anchoring via `recordSettlement` on a real EVM chain (anvil reference; mainnet config one-line switch)
- ✅ Optimistic finality mode with settler bonds, challenge bonds, challenge window, slashing, voiding, reposting, and `isFinalized`
- ✅ Question auto-propagation across the settler mesh
- ✅ Deterministic designated-poster (no double-submission, no coordination required)
- ✅ Live deliberation viewer (Next.js)
- ✅ One-command demo orchestrator
- ✅ Independent CLI proof verifier (`settler/tools/verify_settlement.py`)
- ✅ **83 tests green** (37 Python protocol/identity/consensus/on-chain/proof-verifier tests including v2 reasoning-hash binding and canonical-confidence regression + 37 Solidity Foundry incl. 256-run fuzz + 9 TypeScript SDK smoke tests against the live deployment)

## Quick start

Prerequisites: Node 22+, Go 1.25.5+ (auto-fetched via `GOTOOLCHAIN`), Foundry, Python 3.11+.

```bash
# 1. Build the AXL daemon
git clone https://github.com/gensyn-ai/axl
cd axl && GOTOOLCHAIN=go1.25.5 go build -o ../axl/axl-node ./cmd/node/

# 2. Build SynodRegistry (anvil) + run Foundry tests (25 pass)
cd contracts && forge install foundry-rs/forge-std --no-commit && forge test

# 3. Set up the settler runtime
cd settler && python -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env  # add ANTHROPIC_API_KEY

# 4. Generate AXL identities
bash scripts/axl-keygen.sh node-a
bash scripts/axl-keygen.sh node-b

# 5. Run the full demo (UI on :3000)
bash tools/demo-up.sh
```

### Three-vendor local judge demo (optional)

This local-runner path is **distinct from the live deployment**. The live
swarm at `synod.gudman.xyz` runs **two providers across four model variants**
(Anthropic Sonnet 4.6 / Haiku 4.5 / Opus 4.7 cross-machine, Google Gemini 2.5
Flash). The optional 3-vendor local demo below adds OpenAI for breadth when
running locally with your own keys. Add these to `settler/.env`:

```bash
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
```

Then run:

```bash
python tools/demo-doctor.py --demo 3node
bash tools/demo-up-3node.sh
```

The launcher deploys a fresh local `SynodRegistry`, registers three settlers,
starts AXL nodes on ports `9002`, `9012`, and `9022`, and starts the UI on
`http://localhost:3000`. By default quorum is `2 of 3`; set
`SYNOD_DEMO_QUORUM=3` for strict unanimity. The full judge script is in
[`docs/judge-demo.md`](./docs/judge-demo.md).

For a full pre-recording check that also runs the Python tests, Foundry tests,
and UI build:

```bash
python tools/demo-doctor.py --demo 3node --with-tests
```

## Running just the on-chain integration test

Without the UI, to verify the protocol end-to-end on a local chain:

```bash
bash settler/tools/run_onchain_test.sh
# Expected output:
#   Settlement: (questionId, outcome=1, quorumSize=2, weightedScoreScaled=1940000, ...)
#   ONCHAIN INTEGRATION OK
```

To verify a posted settlement without trusting the UI:

```bash
cd settler
python tools/verify_settlement.py \
  --rpc-url http://127.0.0.1:8545 \
  --registry-address <SynodRegistry> \
  --question-id <64-hex-question-id>
# Expected output: Synod proof: VERIFIED
```

## Mapping to ETHGlobal judging criteria

| Criterion | What Synod brings |
|---|---|
| **Technicality** | Multi-LLM consensus protocol; ed25519-signed canonical-JSON vote payloads bound to prompt/outcomes/deadline; P2P over Yggdrasil mesh; on-chain proof anchor; server-side and CLI proof verifiers; deterministic designated-poster algorithm |
| **Originality** | First AXL-native AI settler swarm shipped against the Open Agents brief. Polymarket has UMA, Augur has REP, Delphi had nothing — Synod fills the AI-native gap with cryptographically signed deliberations, ENS-addressable receipts, and 0G-anchored transcripts |
| **Practicality** | Solves Delphi's actual #1 architectural weakness in week-one of mainnet. Reference implementation Gensyn could integrate as Delphi v2's settler architecture |
| **Usability (UI/UX/DX)** | Live deliberation viewer; one-command demo orchestrator; gitignored env template; ` forge test` + `pytest` round-trip in seconds |
| **WOW factor** | Watch heterogeneous AI models on independent machines reach quorum-gated agreement, see the on-chain transaction hash, then watch the UI independently verify every signature in the proof |

## Gensyn AXL prize submission requirements

| Requirement (verbatim) | Synod compliance |
|---|---|
| "Must use AXL for inter-agent or inter-node communication" | ✅ All settler↔settler messaging is AXL `/send` + `/recv` |
| "No centralised message broker replacing what AXL provides" | ✅ AXL is constitutive — heterogeneous-vendor LLMs *can only* coordinate via something AXL-shaped |
| "Must demonstrate communication across separate AXL nodes, not just in-process" | ✅ Demo runs settler A on host laptop and settler B on Contabo VPS; cross-machine round-trip verified Day 1 |
| "Must be built during the hackathon" | ✅ Repo init April 28, 2026 (after April 24 hackathon start). 10 incremental commits show progress |
| "Depth of AXL integration" | ✅ ed25519 identity reused as both AXL transport key and settlement signing key; AXL `/topology` is the discovery primitive |

## What is new vs reused

**New** (built during hackathon):
- All Synod settler agent code (Python, ~700 LOC)
- Synod deliberation protocol & canonical JSON signing
- `SynodRegistry.sol` + Foundry test suite + deploy script (~470 LOC Solidity)
- On-chain submission client (web3.py wrapper) + designated-poster algorithm
- Next.js live deliberation viewer + proof verifier (~900 LOC TS)
- One-command demo orchestrator
- Architecture spec, AI usage disclosure

**Reused** (open-source dependencies):
- [Gensyn AXL](https://github.com/gensyn-ai/axl) node binary (the prize requirement)
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-python)
- [`cryptography`](https://cryptography.io/) for ed25519 sign/verify
- [`web3.py`](https://web3py.readthedocs.io/) + [`eth-account`](https://eth-account.readthedocs.io/) for EVM transaction signing
- [`viem`](https://viem.sh/) for read-only on-chain access from the UI
- [Foundry](https://getfoundry.sh/) toolchain
- [Next.js](https://nextjs.org/), Tailwind, React

## Scope boundary — v1 vs v1.1

We chose to ship a tight, honest hackathon v1 instead of an overclaimed "production decentralized oracle" prototype. The pitch reflects exactly what's in the code today.

| Concern | v1 (shipped) | v1.1 (designed, not shipped) |
|---|---|---|
| Quorum/arithmetic enforcement | **Off-chain.** `SynodRegistry.recordSettlement` accepts the signed-vote bundle from any registered settler with bond and stores bytes verbatim. The challenge window + slashable bond (`onlySettler`, `minSettlerBond`, `challengeWindowSeconds`) deters fraud economically. | EIP-712 signature aggregation enforced on-chain; per-outcome quorum + winner arithmetic checked in `recordSettlement` |
| Reasoning text in receipts | **Shipped today (Protocol v2):** vote outcome + confidence + question domain + `reasoning_hash` are all bound into the ed25519 signing payload. The displayed reasoning text must hash to the signed `reasoning_hash` or the verifier rejects. Verifiable on transcript root `0x9272c61b5a77bd94…7b7b924` (qid `0x67b3d126…1b069`): `protocol_version: 2`, `reasoning_hash` present and matches `sha256(reasoning)` byte-for-byte. v1 historical settlements (pre-today) remain valid under the v1 verification path. | (closed — v2 live) |
| Verification durability | Verifier reads **current** registry state (`registeredAxlPubKeys`). A revoked or rotated settler invalidates old receipts. | Block-height-pinned verification using `eth_getLogs(SettlerRegistered)` + receipt's settlement block |
| Judgment subname ownership | **Shipped (May 2 2026):** wallet-connect on the inject form → SIWE-style signed owner-declaration → server verifies via `viem.verifyMessage` → mint pipeline issues 3 txs (mint as deployer, set records, `safeTransferFrom` to submitter). Verifiable: `j-67b3d12.synodai.eth`'s `NameWrapper.ownerOf` is the submitter wallet, not the operator. | (closed) |
| Provider heterogeneity | Three models: `claude-sonnet-4-6`, `claude-haiku-4-5`, `gemini-2.5-flash`, plus `claude-opus-4-7` cross-machine. **Two providers** (Anthropic + Google). All settlers use the same SYSTEM_PROMPT — heterogeneity is on the *vendor/model axis*, not the *role axis*. | Specialised analyst/skeptic/synthesizer prompts per role |
| ERC-7857 verifier | Stub `IERC7857DataVerifier` returns `isValid=true`. Mint and transfer flows are real on 0G Galileo (4 tokens minted, 1 transferred). | Real TEE attestation + sealed-key encryption pipeline |
| Stats source | `/api/stats.questionsSettled` reads the local 0G transcript index, not the chain (no `settledCount()` view in v1 contract). On-chain `eth_getLogs` is the canonical source. | Stats endpoint switches to `eth_getLogs(SettlementRecorded)` |
| AXL mesh edge claims | `/network` infers full edges from any peer presence; doesn't correlate exact pubkey both ways. Visual aid, not cryptographic proof. | Pairwise pubkey verification across `/topology` |

### Live receipts you can verify in 30 seconds

```bash
# 1. ENS bootloader (Ethereum mainnet) — registry + RPC + threshold + 4 settler subnames
curl -s https://synod.gudman.xyz/api/ens | jq '{source, parent, subnames: (.subnames | length)}'

# 2. Live AXL mesh + 4 settlers verified across two physical VPS
curl -s https://synod.gudman.xyz/api/network | jq '.nodes[] | {name: .spec.name, online, registered, ensOK: .pubkeyMatchesEns}'

# 3. Recompute a v2-signed-vote proof end-to-end (quorum=3, three signature-valid voters, ed25519 + reasoning_hash bound)
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"questionId":"0x67b3d126ba9213433f6c4d268946b00d91cb608b5bffdcf5d1e59f37b141b069"}' \
  https://synod.gudman.xyz/api/verify-proof | jq '{status, votes: (.votes | length)}'

# 4. Resolve a submitter-owned judgment subname via standard ENS tooling — owner is NOT the operator
cast resolve-name j-67b3d12.synodai.eth     # or use https://app.ens.domains/j-67b3d12.synodai.eth
# NameWrapper.ownerOf(uint256(namehash("j-67b3d12.synodai.eth"))) returns 0x81Ef2F237Cf51aa8c4b1FFd3062046e651be39f0

# 5. Pull a full deliberation transcript from 0G Storage by HTTP — no SDK, no auth
curl -s 'https://indexer-storage-testnet-turbo.0g.ai/file?root=0x168964fb768573420c8bd434c5f6a5216e334a60515b53bd3f6f12e74a4f3775' | jq '.votes | length'

# 6. iNFT contract on 0G Galileo (chain 16602) — 4 settler iNFTs, 1 transfer
# https://chainscan-galileo.0g.ai/address/0x4fF6712B364A06f4f23878dE3c4678E8F48f2D85

# 7. Tamper demo — show the verifier rejecting a forged proof. Run the
# CLI verifier against the same on-chain settlement, then mutate one
# byte of the signed-votes payload locally and re-verify. Result:
# `signature does not match` for the tampered byte; the on-chain
# canonical bytes still verify untouched.
cd settler && python tools/verify_settlement.py \
  --rpc-url https://gensyn-mainnet.g.alchemy.com/public \
  --registry-address 0xD387f749667590940d7c68CA350e57FbcE62b6ad \
  --question-id 67b3d126ba9213433f6c4d268946b00d91cb608b5bffdcf5d1e59f37b141b069
# 'verified'  (3 valid signatures, on-chain quorum matches recomputed quorum)
# Modify any single byte of the on-chain payload off-chain and re-run:
# 'invalid: ed25519 signature is invalid for {pubkey}'
```

### Pitch differentiation — closest past winners and our distinct angle

| Closest past winner | What they did | Synod's distinct angle |
|---|---|---|
| **Ghost in the Machine** (ENS Best Integration 1st, Cannes 2026) | 30+ ENS text records per agent encoding *agent runtime state* — mood, balance, memory, tools, conversation history. Each agent is a subdomain. | Synod stores *protocol bootloader config* in ENS — registry contract, RPC URL, chain id, threshold, settler list — so the live app cold-boots from one ENS name (`synodai.eth`). Different layer of the stack. We can also flip a text record on mainnet and watch the live UI swing — verified today by changing `synod.threshold` from 2 to 3. |
| **VEIL VPN** (ENS Most Creative 1st, Cannes 2026) | TEE attestation + ENS for service discovery — attested VPN nodes register under `veil.eth`. | Synod uses ENS as a **receipt** primitive: every settled question becomes a transferable, ENS-addressable NFT (`j-{hash}.synodai.eth`) carrying outcome + transcript-CID + tx-hash in 8 text records. Owned by the verified submitter wallet (live: `j-67b3d12.synodai.eth` → `0x81Ef…39f0`, not the operator). Nobody in the past 6 years has shipped AI-verdict-as-ENS-subname. |
| **DIVE** (0G Best OpenClaw 2nd, Cannes 2026) | AI swarm + World ID Sybil resistance + 0G Compute TEE inference + iNFTs as agent identity for prediction-market resolution. | Synod's swarm runs on Gensyn AXL (not WS/HTTP), votes are **ed25519-signed with reasoning_hash bound to the signature** (DIVE doesn't bind reasoning), and settlements anchor on Gensyn L2 mainnet. Uses 0G Storage as append-only shared memory rather than 0G Compute for inference. |
| **Alpha Dawg** (0G DeFi 2nd, Cannes 2026) | 14-agent multi-chain swarm with 0G Compute TEE, iNFT memory loops, Hedera audit log, Arc payments. | Different scope: Alpha Dawg is a trading product. Synod is settlement-layer infrastructure. Both are swarms but ours produces **portable, third-party-verifiable receipts** rather than internal memory for one user's account. |
| **Shawarma Orchestrate** (0G DeFi 1st, Cannes 2026) | LangGraph supervisor swarm + 0G Compute + Uniswap + Telegram. Configurable agent prompts. | Shawarma's consensus layer is *unsigned* weighted votes inside one process. Synod's consensus is **cryptographically signed across separate machines** — A in Frankfurt, D in Toronto, peer-to-peer over AXL — and replayable from on-chain bytes alone. |

**Why this matters:** every claim above is in the SUBMISSIONS doc and the README. We'd rather under-claim now than get caught by a sharp judge later. The v1.1 list **is the post-hackathon roadmap** for the Gensyn Foundation grant.

## Roadmap (post-hackathon, for the Gensyn Foundation grant)

The hackathon scope is deliberately tight. The full design extends to:

- **Stake-based participation**: settlers stake $AI to register, slashed if they disagree with quorum (real economic security, real $AI demand)
- **REE integration**: each settler's inference runs in Gensyn's Reproducible Execution Environment so settlement is bitwise-deterministic + verifiable
- **Permissionless settler enrollment**: replace admin-curated allowlist with $AI-stake-weighted set
- **Multi-outcome markets**: extend beyond binary outcomes
- **Direct Delphi integration**: work with Gensyn to expose a settler interface so Synod can serve as the actual settler for live Delphi markets

## License

MIT. See [LICENSE](./LICENSE).

## AI usage

Built with assistance from Claude Code (Anthropic Opus 4.7). Full attribution + spec/prompt artifacts in [AI_USAGE.md](./AI_USAGE.md).

## Repo

https://github.com/Ridwannurudeen/synod
