# Synod — ETHGlobal Open Agents Submission Bodies

Final submission text for the four prize tracks, as drafted on 2026-04-30.
**DO NOT submit any of these without explicit user approval.**

---

## SHARED METADATA (across all tracks)

- **Project name**: Synod
- **Tagline**: AI Receipts — verifiable, transferable, ENS-addressable, 0G-anchored proofs of multi-model AI consensus
- **Live demo**: https://synod.gudman.xyz
- **GitHub**: https://github.com/Ridwannurudeen/synod
- **Demo video**: [link to be added after recording]
- **Team**: Ridwan Nurudeen (solo) — TG: @ggudman, X: @ggudman
- **Contract addresses**:
  - SynodRegistry on Gensyn L2 (chain 685689): `0xD387f749667590940d7c68CA350e57FbcE62b6ad`
  - synodai.eth on Ethereum mainnet (resolver `0x231b…E63`, NameWrapper `0xD441…6401`)
- **Started**: 2026-04-23 (verifiable in git log)

---

## Track 1 — Gensyn AXL ($5,000 pool, max $2,500 1st)

### Project name + short description
**Synod** — A production AI consensus protocol where independent settler agents on separate machines coordinate over Gensyn AXL to reach quorum-signed agreement on questions, then post the cryptographic settlement on-chain to Gensyn L2.

### How AXL is used (depth)
AXL is the **only** transport between settlers. There is no central coordinator, no Redis pub/sub, no HTTP-based mesh — only AXL.

- Each settler runs a local AXL daemon (`axl-node`) with its own ed25519 identity.
- Settlement votes flow via `POST /send` on the local AXL API → encrypted Yggdrasil mesh → peer's AXL daemon → settler's `GET /recv`.
- Cross-machine: Settler D runs on a different physical VPS (Servarica, Toronto) and meshes with Settlers A/B/C on Contabo (Frankfurt) over the public Internet via `tls://75.119.153.252:9101`. UFW restricts inbound to Servarica's IP only.
- The mesh is **bidirectional and verifiable**:
  - From Contabo: `curl 127.0.0.1:9002/topology` shows D as inbound peer at `tls://38.49.212.102:49260`
  - From Servarica: `curl 127.0.0.1:9202/topology` shows A's public listener as outbound peer
- Each settler's mesh ed25519 pubkey is registered in `SynodRegistry.settlers` mapping on Gensyn L2 AND mirrored in `synod.pubkey` text record under `settler-{a,b,c,d}.synodai.eth`. A pubkey mismatch breaks consensus.

### What this proves
The /network UI cross-checks three sources of truth in real time:
1. Live AXL daemon `/topology` (what the box claims about itself)
2. SynodRegistry `settlers(addr)` on-chain (what the protocol agreed on)
3. ENS subname `synod.pubkey` text record (what the public name asserts)

A green pulse dot requires all three to agree.

### Hackathon-specific deliverables for AXL
- **Cross-machine mesh proof**: documented commands above; reproducible
- **Independent verifier**: `tools/verify_settlement.py` recomputes everything from raw chain bytes — no AXL state needed for verification
- **Production usage**: live URL has continuous activity; first mainnet settlement tx `0xc96835176b03b91e13907bab612ebdf79a0d5fe60647c76f2d6b06fa46ab8b82`

### Foundation grant fit
Synod is the AXL-native flagship use case: trust-minimized AI consensus infrastructure, fully P2P, no central anything. We're committed to taking this from hackathon prototype to production protocol — clear post-hackathon roadmap in ROADMAP.md (challenge/slash mechanism, multi-chain registry, cross-network bridges).

---

## Track 2 — ENS — Best ENS Integration for AI Agents ($2,500 pool, max $1,250 1st)

### Project name + short description
**Synod** — `synodai.eth` is the bootloader for the entire AI consensus protocol: registry contract address, RPC URL, chain id, threshold, and the canonical settler list all live in on-chain text records on Ethereum mainnet. Cold-boot a UI from one ENS name; it self-configures.

### Alignment with ENS's published direction
The ENS team has explicitly endorsed subname-per-agent + text records + ERC-8004 reputation as the AI agent identity pattern: [*ENS as the AI Agent Identity Layer (with ERC-8004)*](https://ens.domains/blog/post/ens-ai-agent-erc8004). Synod implements this pattern faithfully — and adds the bootloader and judgment-subname extensions as described below.

### How ENS does real work (not cosmetic)

**Parent record (`synodai.eth`)** holds the network's runtime config in text records:
- `synod.registry` → `0xD387…b6ad` (the SynodRegistry on Gensyn L2)
- `synod.chain-id` → `685689`
- `synod.rpc` → Gensyn L2 RPC
- `synod.threshold` → quorum requirement
- + url, description, com.github, synod.verify-url, synod.network-url

**Subnames (`settler-{a,b,c}.synodai.eth`)** are the canonical agent identity layer:
- `addr` → settler's EVM address on Gensyn L2
- `synod.role` → human-readable role (e.g. "anthropic-claude-sonnet-4-6")
- `synod.pubkey` → ed25519 mesh pubkey
- `synod.parent` → `synodai.eth`

### Demo of load-bearing-ness
Live demo lever: I edit `synodai.eth`'s `synod.registry` text record on mainnet → refresh `/api/ens?refresh=1` → `/network` UI swings to a different deployment. Removing a subname removes the settler from the page. Changing `synod.pubkey` breaks the cross-check and turns the settler card amber.

### Public resolution endpoint (other AI projects can hit this)
```
GET https://synod.gudman.xyz/api/agent/{ens-name}
```

Returns the full composed profile: ENS resolution + on-chain registry tuple + live AXL daemon probe + cross-check flags. Example: `curl https://synod.gudman.xyz/api/agent/settler-a.synodai.eth`

### What's novel
- **ENS subnames as agent identity**, with cryptographic cross-check against on-chain registry AND live daemon
- **ENS as the bootloader** — UI cold-boots from one ENS name; no env vars, no config files
- **Public profile API** that any AI project can adopt

### Functional, no hard-coded values
The /network page reads everything via `viem` from on-chain ENS records. The settler list is enumerated from subnames; the registry is loaded from a parent text record. There are zero hard-coded addresses on the page.

---

## Track 3 — ENS — Most Creative Use of ENS ($2,500 pool, max $1,250 1st)

### Project name + short description
**Synod ships AI Judgment NFTs as ENS subnames.** After a consensus event, the protocol mints `j-{shortHash}.synodai.eth` — a transferable, ENS-addressable NFT carrying the AI verdict in 8 text records (outcome, quorum, weighted-score, transcript-CID, settlement tx, prompt, parent, description). The subname is minted **directly to the question submitter's wallet** (verified by SIWE-style signature on the inject form), so the judgment NFT is theirs to keep, transfer, or sell on OpenSea. 3 minted live on Ethereum mainnet during the hackathon. Latest: `j-67b3d12.synodai.eth` is owned by `0x81Ef2F237Cf51aa8c4b1FFd3062046e651be39f0`, a wallet that is **not** the operator — verifiable via `NameWrapper.ownerOf(uint256(namehash))`.

**Mint flow (3 transactions per judgment):**
1. `NameWrapper.setSubnodeRecord(parent, label, deployer, resolver, …)` — mint owned by deployer (only owner can call setText)
2. `PublicResolver.multicall([setAddr(submitter), setText × 7])` — set all 8 text records in one tx
3. `NameWrapper.safeTransferFrom(deployer, submitter, tokenId, 1, "")` — transfer to verified submitter

The signature scheme: the inject form has the user sign a canonical "Synod judgment owner declaration" message containing their address, the prompt, and an ISO timestamp. The server reconstructs the message, validates the timestamp window (5 minutes), checks the signature with `viem.verifyMessage`, and persists `{ address, signedAt, message, signature }` to `runtime/submitters.json` keyed by questionId. The mint script reads that file and uses the verified address as the subname owner.

### Why this is novel
We use ENS subnames as a **portable proof-of-AI-decision primitive**. Every AI consensus event can become a queryable, transferable artifact:

- **Addressable**: anyone resolves `j-abc123.synodai.eth` → verdict + transcript pointer (verified live for both minted subnames via `viem.getEnsText`)
- **Transferable**: NameWrapper-wrapped, the owner can transfer or sell on OpenSea
- **Cryptographically tied** to the on-chain settlement (via `synod.tx`) and the off-chain transcript (via `synod.transcript-cid` pointing to 0G Storage)
- **Renewable / extensible**: future records (e.g. challenge results, reputation updates) can be appended to the same subname

### Text record schema on each judgment subname
```
addr                  -> question submitter (owner)
synod.outcome         -> "yes" / "no" / "1" etc
synod.quorum          -> "2/3" (votes-for-winner / total settlers)
synod.weighted-score  -> scaled int (* 10^6)
synod.transcript-cid  -> 0G Storage merkle root (recoverable via HTTP indexer)
synod.tx              -> Gensyn L2 settlement tx hash
synod.question        -> truncated prompt (≤200 chars)
synod.parent          -> synodai.eth
description           -> human-readable summary
```

### What's actually new (vs. existing ENS uses)
This is materially different from the canonical "ENS as username" or "ENS as profile" use:
- The subname is the *output of an AI process*, not the identity of an actor
- It encodes *what was decided*, not *who is who*
- Standard NFT primitives (transfer, sell, royalty) work for free since ENS subnames are NFTs

### Discoverability
Browse all of Synod's judgments by enumerating subnames under `synodai.eth`. ENS becomes the public bulletin board of every AI consensus event the protocol has produced.

### Functional implementation
`/api/judgment/{questionId}` returns the live ENS subname for any minted-judgment question. The mint flow uses the deployer wallet to call `NameWrapper.setSubnodeRecord` + `PublicResolver.multicall(setText x N)`. Implementation in `settler/synod_settler/judgment_ens.py` and `settler/tools/mint_judgment.py`. The /network page resolves all parent + subname text records live via `viem.getEnsText` against Ethereum mainnet — that page contains zero hardcoded settler addresses.

### Bonus: ENSIP draft
We've drafted an informal ENSIP at `docs/ENSIP-DRAFT-AI-AGENT-IDENTITY.md` proposing the parent/subname/judgment-subname schema as a standard for AI agent identity in ENS. This is the primitive other AI projects can adopt. Not just "Synod uses ENS"; we want this to become "AI agents use ENS, here's how."

### Alignment with ENS's published direction
The ENS team's blog post [*ENS as the AI Agent Identity Layer (with ERC-8004)*](https://ens.domains/blog/post/ens-ai-agent-erc8004) explicitly endorses subname-per-agent + text records + ERC-8004 reputation references — exactly the pattern Synod implements. We converged on this schema independently while building, and the ENSIP draft formalizes it for cross-project adoption.

---

## Track 4 — 0G — Best Autonomous Agents, Swarms & iNFT Innovations ($7,500 pool, $1,500 each up to 5)

### Project name + short description
**Synod** — A vendor-diverse AI swarm (4 settlers, 4 model variants across Anthropic + Google) that collaborates over P2P transport, signs settlement votes with ed25519, and persists every full deliberation transcript to 0G Storage as the swarm's shared memory. Each settler uses the same prompt — heterogeneity is on the model/vendor axis, not the role axis (per-role specialisation is v1.1).

### How 0G is used
**0G Storage Log** is the swarm's shared memory layer. After every successful on-chain settlement, the designated poster uploads the full deliberation transcript via the `0g-storage-client` Go binary:
```
0g-storage-client upload \
  --url https://evmrpc-testnet.0g.ai \
  --indexer https://indexer-storage-testnet-turbo.0g.ai \
  --key $SYNOD_0G_KEY \
  --file transcript.json
```

The merkle root returned by the upload is saved locally and surfaced in:
- `/api/transcript/{questionId}` REST endpoint
- The judgment subname's `synod.transcript-cid` text record
- The verify page's ProvenancePanel

**Retrieval is pure HTTP — no SDK, no auth, no key required**:
```
curl https://indexer-storage-testnet-turbo.0g.ai/file?root=0x{merkleRoot}
```

### Swarm coordination details
- 4 settlers across **two providers + four model variants**: Anthropic `claude-sonnet-4-6` (Settler A), Anthropic `claude-haiku-4-5` (Settler B), Google `gemini-2.5-flash` (Settler C), Anthropic `claude-opus-4-7` (Settler D, on a separate VPS in Toronto). All four use the same SYSTEM_PROMPT — heterogeneity is on the **model/vendor axis**, not the role axis. Per-role specialization (analyst / skeptic / synthesizer) is v1.1.
- Each settler reasons independently, signs its vote with its ed25519 key
- Per-outcome quorum: the *winning outcome* needs ≥N votes for THAT outcome (not majority among all). Confirmed in `settler/synod_settler/consensus.py:77-81` and exercised by `tests/test_consensus.py:35-46`
- Deterministic poster: lowest-hex-pubkey among voters submits on-chain (one tx per question, no double-spending)
- Full reasoning chain persisted to 0G Storage; recoverable months later via the indexer
- **Honest scope:** in v1, the on-chain registry contract anchors the signed-vote bundle without verifying signatures or quorum arithmetic on-chain. Verification is independently performed off-chain by `ui/lib/proof-verifier.ts` and `settler/tools/verify_settlement.py`. v1.1 moves this on-chain via EIP-712 + per-block registry snapshots.

### Why 0G Storage specifically
- We need **append-only history** of every consensus event with **public retrieval**
- 0G Storage's HTTP indexer (`?root=...`) makes it the only decentralized storage that's both content-addressed AND retrievable from a browser without a special client
- Cost is negligible (~30k neuron per upload at 2KB transcripts)
- The on-chain submission tx on 0G Chain provides cryptographic provenance that the transcript existed at a specific block height

### What this proves
A judge can verify any settled question's reasoning chain in three independent steps:
1. On-chain: `getSettlement(questionId)` on Gensyn L2 returns the canonical outcome + signed votes
2. 0G Storage: `GET /file?root=…` returns the full transcript with each settler's reasoning
3. ENS: the judgment subname's `synod.transcript-cid` ties (1) and (2) together with a public, queryable name

### ERC-7857 iNFT minting (NEW)

Each settler is now also minted as an **ERC-7857 iNFT on 0G Chain Galileo** using 0G Labs' reference implementation (`github.com/0glabs/0g-agent-nft`, branch `eip-7857-draft`). Live deployment:

| Component | Address |
|---|---|
| AgentNFT (proxy) | [`0x4fF6712B364A06f4f23878dE3c4678E8F48f2D85`](https://chainscan-galileo.0g.ai/address/0x4fF6712B364A06f4f23878dE3c4678E8F48f2D85) |
| Verifier (stub) | `0x5171e1F5d16647096f090Cda5faA2550Db5EF6fe` |
| Deployer | `0xc9c0754fDB2C22Fd19B5B649e1e60eE9d1Ccca3f` |

**Minted iNFTs** (each owned by the settler's EVM address; `dataHash = keccak256(role ‖ ed25519 pubkey ‖ ENS fqn)`):

| tokenId | settler | owner | tx |
|---|---|---|---|
| 0 | sonnet | 0xA783… | [`0x01504f51…`](https://chainscan-galileo.0g.ai/tx/0x01504f51e4fd3cf27296fec2fa6b562c11a149210e75c70e0f7703971c19ac7a) |
| 1 | haiku | 0x6E8b… | [`0xadfcf922…`](https://chainscan-galileo.0g.ai/tx/0xadfcf922750b4e8cb41b9a0f7daca9b695460fcead65868d8dbfb1ca05683aca) |
| 2 | gemini | 0x0f09… | [`0x83361c7f…`](https://chainscan-galileo.0g.ai/tx/0x83361c7fdeb5636a0c2506b534abfc8db5386d901deb5772e38654fbff50739f) |
| 3 | opus | 0x44e7… | [`0x8039cee0…`](https://chainscan-galileo.0g.ai/tx/0x8039cee026ec75680a7ee664e8ace968f740151b14ec00fd5baf60ae75cbf80b) |

**Live transfer demonstration**: We executed an actual ERC-7857 `transfer()` on token #0 from settler-a to a fresh receiver wallet, producing a valid receiver-signed accessibility proof per the spec. Tx: [`0xa2805f44…3ab4c04`](https://chainscan-galileo.0g.ai/tx/0xa2805f447c1865f347786fd51aba0fc53f60b79816ab815ceeaa7d4843ab4c04) (block 31098066). This proves the **full** ERC-7857 transfer flow works end-to-end on our deployment — not just the mint side.

**Honest scope note:** This deployment uses a stubbed `IERC7857DataVerifier` (returns `isValid=true`) rather than a real TEE attestation, and the dataHash binds settler identity (role + pubkey + ENS subname) but does not yet carry an encrypted intelligence payload via the full sealed-key flow. Both are achievable v1.1 work — the contract surface is in place and the standard mint + transfer flows work end-to-end. We chose to ship a real ERC-7857 deployment over a half-finished encryption pipeline.

This is a 4th independent piece of the swarm's identity stack, on top of the 0G Storage transcripts:

- **Gensyn L2** — settlement record (canonical outcome, signed votes)
- **0G Storage** — full deliberation transcript (HTTP-retrievable)
- **Ethereum mainnet ENS** — agent identity + transferable judgment subnames
- **0G Chain ERC-7857 iNFTs** — each settler minted, ownable, transferable per the standard

### Verified live
- 0G key wallet: `0xc9c0754fDB2C22Fd19B5B649e1e60eE9d1Ccca3f` (0G Galileo testnet, chain 16602)
- First persisted transcript: question `4320be…0823`, root `0xd4d7dc99…a18cf2`, 2141 bytes
- Live retrieval: https://indexer-storage-testnet-turbo.0g.ai/file?root=0xd4d7dc99e0404b1d163f1d80712edb81cc44a569f121c75919fee81b76a18cf2

---

## AI_USAGE attribution (mandatory per ETHGlobal)

Per ETHGlobal rules, transparency about AI tool usage:

**Tool**: Anthropic Claude (Sonnet 4.6, Opus 4.7) via Claude Code CLI
**Where used**:
- Architecture brainstorming + tradeoff analysis (verbal, not committed)
- Boilerplate code generation: API route handlers, ABI typings, env-config loaders
- Smart contract scaffolding (later hand-edited for security)
- Documentation drafts (this file, README, ENSIP draft)
- Demo theater script

**What's NOT AI**:
- The architecture decisions (per-outcome quorum, deterministic poster, ed25519 + ENS cross-check)
- The 0G Storage HTTP gateway approach (after the SDK failed, hand-debugged)
- All security-relevant code (key handling, signature verification, on-chain submission)
- The product positioning ("AI Receipts", judgment-subname primitive)
- All code review and integration testing

**Spec artifacts**: All planning documents are in `docs/` and visible in git history. Memory files describing the strategic plan are external to the repo.
