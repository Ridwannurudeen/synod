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
**Synod** — An AXL-native AI settler swarm. 4 settlers across 2 physical VPS (Frankfurt + Toronto) coordinate exclusively over Gensyn AXL, sign deliberations with ed25519, reach per-outcome quorum, and post cryptographic settlement records on Gensyn L2 mainnet (chain 685689). 70+ on-chain `SettlementRecorded` events shipped during the hackathon, all driven by AXL traffic — no central coordinator, no fallback transport.

### How AXL is used (depth)
AXL is the **only** transport between settlers. There is no central coordinator, no Redis pub/sub, no HTTP-based mesh — only AXL.

- Each of the 4 settlers runs a local AXL daemon (`axl-node`) with its own ed25519 identity.
- Settlement votes flow via `POST /send` on the local AXL API → encrypted Yggdrasil mesh → peer's AXL daemon → settler's `GET /recv`.
- Cross-machine: Settler D runs on a different physical VPS (Servarica, Toronto) and meshes with Settlers A/B/C on Contabo (Frankfurt) over the public Internet via `tls://75.119.153.252:9101`. UFW restricts inbound to Servarica's IP only.
- The mesh is **bidirectional and verifiable**:
  - From Contabo: `curl 127.0.0.1:9002/topology` shows D as inbound peer at `tls://38.49.212.102:49260`
  - From Servarica: `curl 127.0.0.1:9202/topology` shows A's public listener as outbound peer
- Each settler's mesh ed25519 pubkey is registered in `SynodRegistry.settlers` mapping on Gensyn L2 (`0xD387f749667590940d7c68CA350e57FbcE62b6ad`) AND mirrored in `synod.pubkey` text record under `settler-{a,b,c,d}.synodai.eth`. A pubkey mismatch breaks consensus.

### What this proves
The /network UI cross-checks three sources of truth in real time:
1. Live AXL daemon `/topology` (what the box claims about itself)
2. SynodRegistry `settlers(addr)` on Gensyn L2 (what the protocol agreed on)
3. ENS subname `synod.pubkey` text record on Ethereum mainnet (what the public name asserts)

A green pulse dot requires all three to agree across two machines, two L2s, and one mainnet.

### Hackathon-specific deliverables for AXL
- **Cross-machine swarm proof**: documented commands above; reproducible from a clean clone
- **70+ live settlements** on Gensyn L2 mainnet; first settlement tx `0xc96835176b03b91e13907bab612ebdf79a0d5fe60647c76f2d6b06fa46ab8b82`
- **Independent verifier**: `tools/verify_settlement.py` recomputes everything from raw chain bytes — no AXL state needed for verification
- **83 tests across Python + Foundry + SDK** (37 Python protocol/identity/consensus/onchain/proof-verifier including v2 reasoning-hash binding and canonical-confidence regression; 37 Solidity Foundry including 256-run fuzz; 9 TypeScript SDK smoke tests against the live deployment)
- **Production usage**: live URL https://synod.gudman.xyz has continuous swarm activity

### Foundation grant fast-track fit
Gensyn's qualification text states *"All winners are fast-tracked into the Gensyn Foundation grant programme."* We are explicitly committed to taking Synod from hackathon prototype to production AXL-native protocol via that fast-track. The concrete v1.1 design — on-chain EIP-712 signature verification, per-block registry snapshots, challenge/slash mechanism, multi-chain registry, cross-network bridges — is documented in the README's `Scope boundary — v1 vs v1.1` section and in `ROADMAP.md`. Synod is the AXL-native flagship use case: trust-minimized AI swarm infrastructure, fully P2P, no central anything.

---

## Track 2 — ENS — Best ENS Integration for AI Agents ($2,500 pool, max $1,250 1st)

### Project name + short description
**Synod uses ENS as a runtime bootloader for an AI swarm.** `synodai.eth` is not a profile or vanity name — it is the cold-boot config for the entire protocol. Registry contract address, RPC URL, chain id, threshold, and the canonical 4-settler list all live in on-chain text records on Ethereum mainnet. Point a fresh UI at one ENS name and it self-configures end-to-end.

### Alignment with ENS's published direction
The ENS team has explicitly endorsed subname-per-agent + text records + ERC-8004 reputation as the AI agent identity pattern: [*ENS as the AI Agent Identity Layer (with ERC-8004)*](https://ens.domains/blog/post/ens-ai-agent-erc8004). Synod implements that pattern faithfully and extends it with two primitives the blog post does not cover: (1) ENS as the protocol's bootloader, (2) ENS subnames as transferable AI judgment NFTs (Track 3).

### ENS as the bootloader — load-bearing, not cosmetic

**Parent record (`synodai.eth`)** holds the swarm's runtime config in text records:
- `synod.registry` → `0xD387f749667590940d7c68CA350e57FbcE62b6ad` (SynodRegistry on Gensyn L2)
- `synod.chain-id` → `685689`
- `synod.rpc` → Gensyn L2 RPC
- `synod.threshold` → quorum requirement
- + url, description, com.github, synod.verify-url, synod.network-url

**Subnames (`settler-{a,b,c,d}.synodai.eth`)** are the canonical agent identity layer for the 4-member swarm:
- `addr` → settler's EVM address on Gensyn L2
- `synod.role` → human-readable role (e.g. `anthropic-claude-sonnet-4-6`, `anthropic-claude-haiku-4-5`, `google-gemini-2.5-flash`, `anthropic-claude-opus-4-7`)
- `synod.pubkey` → ed25519 mesh pubkey
- `synod.parent` → `synodai.eth`

### Demo lever — observable today
Edit `synodai.eth`'s `synod.registry` text record on mainnet → call `/api/ens?refresh=1` → within one cache cycle the live `/network` UI swings to a different deployment. Removing a subname drops the settler from the page. Changing `synod.pubkey` breaks the cross-check and turns the settler card amber.

**Worked example shipped today**: we flipped `synod.threshold` on `synodai.eth` from `2` to `3` on Ethereum mainnet during the hackathon. The change is visible on-chain on the resolver, and the live UI picked up the new quorum requirement on the next cache refresh — no redeploy, no env-var change, no config file edit. The ENS record is the source of truth.

### Public resolution endpoint (other AI projects can hit this)
```
GET https://synod.gudman.xyz/api/agent/{ens-name}
```

Returns the full composed profile: ENS resolution + on-chain registry tuple + live AXL daemon probe + cross-check flags. Example: `curl https://synod.gudman.xyz/api/agent/settler-a.synodai.eth`

### What's novel here (vs. agent-state-in-text-records prior art)
Past Open Agents winners have used ENS text records as agent state stores (mood, balance, tool list, memory). Synod's contribution is complementary, not derivative: ENS as the *deploy-time wiring* of a multi-agent swarm. One name to bootstrap a registry, an RPC, a chain id, a quorum threshold, and the canonical settler set — then the runtime cross-checks each settler's claimed pubkey against both the on-chain registry and the live AXL daemon. Three sources of truth, one ENS root.

### Functional, no hard-coded values
The /network page reads everything via `viem` from on-chain ENS records. The settler list is enumerated from subnames; the registry is loaded from a parent text record. There are zero hard-coded addresses on the page.

---

## Track 3 — ENS — Most Creative Use of ENS ($2,500 pool, max $1,250 1st)

### Project name + short description
**AI verdicts as transferable, ENS-addressable NFTs.** After every consensus event, the swarm mints `j-{shortHash}.synodai.eth` — a NameWrapper-wrapped ENS subname whose 8 text records carry the AI verdict (outcome, quorum, weighted score, transcript CID, settlement tx, prompt, parent, description) and whose owner is the question submitter, not the protocol operator. The judgment is theirs to keep, transfer, or list on OpenSea. **3 judgment subnames live on Ethereum mainnet today**:

- [`j-35af530.synodai.eth`](https://app.ens.domains/j-35af530.synodai.eth) — sky-blue prompt-injection demo question (operator-minted, v1 mint pattern)
- [`j-4320bed.synodai.eth`](https://app.ens.domains/j-4320bed.synodai.eth) — first 0G-anchored transcript ([root `0xd4d7dc99…a18cf2`](https://indexer-storage-testnet-turbo.0g.ai/file?root=0xd4d7dc99e0404b1d163f1d80712edb81cc44a569f121c75919fee81b76a18cf2), operator-minted, v1)
- [`j-67b3d12.synodai.eth`](https://app.ens.domains/j-67b3d12.synodai.eth) — **submitter-owned (v1.1 wallet-mint pattern, today)**

### Live verifiable artifact
`j-67b3d12.synodai.eth` is owned by `0x81Ef2F237Cf51aa8c4b1FFd3062046e651be39f0` — a verified question submitter, **not** the deployer `0xbEdBe31d…03CFcf`. Anyone can confirm directly:

```
NameWrapper.ownerOf(uint256(namehash("j-67b3d12.synodai.eth")))
  → 0x81Ef2F237Cf51aa8c4b1FFd3062046e651be39f0
```

The ownership is on-chain on Ethereum mainnet, public, and standalone-verifiable without any Synod infrastructure.

### Why this is novel
ENS subnames have been used as usernames, agent profiles, and agent state stores. They have not, to our knowledge, been used as a **portable proof-of-AI-decision primitive** transferable to a third-party submitter wallet. Each Synod judgment is:

- **Addressable**: anyone resolves `j-abc123.synodai.eth` → verdict + 0G transcript pointer (verified live via `viem.getEnsText`)
- **Transferable**: NameWrapper-wrapped, the owner can transfer or list on OpenSea like any ERC-1155
- **Cryptographically tied** to the on-chain settlement on Gensyn L2 (via `synod.tx`) and the off-chain transcript on 0G Storage (via `synod.transcript-cid`)
- **Owned by the asker, not the swarm** — the operator hands over the artifact at mint time

The subname is the *output of an AI process*, not the identity of an actor. It encodes *what was decided*, not *who is who*. Standard NFT primitives (transfer, sell, royalty) work for free since ENS subnames are NFTs.

### Mint flow (3 transactions per judgment) — preserved as differentiator
1. `NameWrapper.setSubnodeRecord(parent, label, deployer, resolver, …)` — mint owned by deployer (only the current owner can call setText)
2. `PublicResolver.multicall([setAddr(submitter), setText × 7])` — set all 8 text records in one tx
3. `NameWrapper.safeTransferFrom(deployer, submitter, tokenId, 1, "")` — transfer to verified submitter

The signature scheme: the inject form has the user sign a canonical "Synod judgment owner declaration" message containing their address, the prompt, and an ISO timestamp. The server reconstructs the message, validates the timestamp window (5 minutes), checks the signature with `viem.verifyMessage`, and persists `{ address, signedAt, message, signature }` to `runtime/submitters.json` keyed by questionId. The mint script reads that file and uses the verified address as the subname owner. The deployer never decides who owns a judgment — the signature does.

### Text record schema on each judgment subname
```
addr                  -> question submitter (owner)
synod.outcome         -> "yes" / "no" / "1" etc
synod.quorum          -> "3/4" (votes-for-winner / total registered settlers; example shape)
synod.weighted-score  -> scaled int (* 10^6)
synod.transcript-cid  -> 0G Storage merkle root (recoverable via HTTP indexer)
synod.tx              -> Gensyn L2 settlement tx hash (chain 685689)
synod.question        -> truncated prompt (≤200 chars)
synod.parent          -> synodai.eth
description           -> human-readable summary
```

### Discoverability
Browse all of Synod's judgments by enumerating subnames under `synodai.eth`. ENS becomes the public bulletin board of every AI consensus event the swarm has produced.

### Functional implementation
`/api/judgment/{questionId}` returns the live ENS subname for any minted-judgment question. Implementation in `settler/synod_settler/judgment_ens.py` and `settler/tools/mint_judgment.py`. The /network page resolves all parent + subname text records live via `viem.getEnsText` against Ethereum mainnet — that page contains zero hardcoded settler addresses.

### Bonus: ENSIP draft
We've drafted an informal ENSIP at `docs/ENSIP-DRAFT-AI-AGENT-IDENTITY.md` proposing the parent/subname/judgment-subname schema as a standard for AI agent identity in ENS. This is the primitive other AI projects can adopt. Not just "Synod uses ENS"; we want this to become "AI swarms use ENS, here's how."

### Alignment with ENS's published direction
The ENS team's blog post [*ENS as the AI Agent Identity Layer (with ERC-8004)*](https://ens.domains/blog/post/ens-ai-agent-erc8004) explicitly endorses subname-per-agent + text records + ERC-8004 reputation references — exactly the pattern Synod implements. We converged on this schema independently while building, and the ENSIP draft formalizes it (including the judgment-NFT extension) for cross-project adoption.

---

## Track 4 — 0G — Best Autonomous Agents, Swarms & iNFT Innovations ($7,500 pool, $1,500 each up to 5)

### Project name + short description
**Vendor-diverse AI settler swarm — 4 settlers across 2 providers, ed25519-signed deliberations persisted verbatim to 0G Storage as the swarm's append-only shared memory, retrievable via pure HTTP.** No SDK, no auth, no key required for retrieval — anyone, any browser, any future verifier can pull a full deliberation transcript from `https://indexer-storage-testnet-turbo.0g.ai/file?root=0x...` and replay the swarm's reasoning chain. **175 KB+ of transcripts** persisted on 0G Storage Galileo during the hackathon, one per on-chain settlement (70+ events on Gensyn L2 chain 685689).

### Why a swarm — and how heterogeneity is real
Synod is a 4-settler swarm running across **two physical VPS** (Frankfurt + Toronto) and **two AI providers + four model variants**:

| Settler | Provider | Model | VPS |
|---|---|---|---|
| A | Anthropic | `claude-sonnet-4-6` | Contabo (Frankfurt) |
| B | Anthropic | `claude-haiku-4-5` | Contabo (Frankfurt) |
| C | Google | `gemini-2.5-flash` | Contabo (Frankfurt) |
| D | Anthropic | `claude-opus-4-7` | Servarica (Toronto) |

All four settlers use the **same** SYSTEM_PROMPT — heterogeneity is on the **model/vendor/machine axis**, not the role axis. A correlated outage at one provider, one model family, or one datacenter cannot silently take quorum down. Per-role specialisation (analyst / skeptic / synthesizer) is v1.1 work.

Each settler reasons independently, signs its vote with its own ed25519 key, ships the vote over Gensyn AXL (no other transport), and the deterministic poster (lowest hex pubkey among voters) submits the canonical settlement on-chain. Per-outcome quorum: the *winning outcome* needs ≥N votes for THAT outcome (not majority among all). Confirmed in `settler/synod_settler/consensus.py:77-81` and exercised by `tests/test_consensus.py:35-46`.

### 0G Storage as the swarm's shared memory
**0G Storage Log** is the swarm's append-only shared memory layer. After every successful on-chain settlement, the designated poster uploads the full deliberation transcript (every settler's reasoning, vote, signature, and the consensus arithmetic) via the `0g-storage-client` Go binary:
```
0g-storage-client upload \
  --url https://evmrpc-testnet.0g.ai \
  --indexer https://indexer-storage-testnet-turbo.0g.ai \
  --key $SYNOD_0G_KEY \
  --file transcript.json
```

The merkle root returned by the upload is saved locally and surfaced in:
- `/api/transcript/{questionId}` REST endpoint
- The judgment subname's `synod.transcript-cid` text record on Ethereum mainnet
- The verify page's ProvenancePanel

**Retrieval is pure HTTP — no SDK, no auth, no key required**:
```
curl https://indexer-storage-testnet-turbo.0g.ai/file?root=0x{merkleRoot}
```

This is the only decentralized storage we know of that is content-addressed AND browser-retrievable without a special client. Cost is negligible (~30k neuron per upload at ~2 KB transcripts). The 0G Chain submission tx provides cryptographic provenance that the transcript existed at a specific block height.

### What this proves — three independent verification paths
A judge can verify any settled question's reasoning chain in three independent steps, no Synod infrastructure required:
1. **Gensyn L2**: `getSettlement(questionId)` on `0xD387f749667590940d7c68CA350e57FbcE62b6ad` returns the canonical outcome + signed votes
2. **0G Storage**: `GET /file?root=…` returns the full deliberation transcript with each settler's reasoning
3. **Ethereum mainnet ENS**: the judgment subname's `synod.transcript-cid` ties (1) and (2) together with a public, queryable name

**Honest scope (v1):** the on-chain Gensyn L2 registry anchors the signed-vote bundle without verifying signatures or quorum arithmetic on-chain. Verification is independently performed off-chain by `ui/lib/proof-verifier.ts` and `settler/tools/verify_settlement.py`. v1.1 moves this on-chain via EIP-712 + per-block registry snapshots.

### Verified live (0G Storage)
- 0G key wallet: `0xc9c0754fDB2C22Fd19B5B649e1e60eE9d1Ccca3f` (0G Galileo testnet, chain 16602)
- First persisted transcript: question `4320be…0823`, root `0xd4d7dc99…a18cf2`, 2141 bytes
- Live retrieval: https://indexer-storage-testnet-turbo.0g.ai/file?root=0xd4d7dc99e0404b1d163f1d80712edb81cc44a569f121c75919fee81b76a18cf2

### Secondary identity layer — ERC-7857 iNFTs on 0G Chain
On top of the 0G Storage memory layer, each of the 4 settlers is also minted as an **ERC-7857 iNFT on 0G Chain Galileo** using 0G Labs' reference implementation (`github.com/0glabs/0g-agent-nft`, branch `eip-7857-draft`). The iNFT is the swarm's transferable on-chain identity, sibling to the ENS subname identity on Ethereum mainnet.

| Component | Address |
|---|---|
| AgentNFT (proxy) | [`0x4fF6712B364A06f4f23878dE3c4678E8F48f2D85`](https://chainscan-galileo.0g.ai/address/0x4fF6712B364A06f4f23878dE3c4678E8F48f2D85) |
| Verifier (stub) | `0x5171e1F5d16647096f090Cda5faA2550Db5EF6fe` |
| Deployer | `0xc9c0754fDB2C22Fd19B5B649e1e60eE9d1Ccca3f` |

**4 minted iNFTs** (token IDs 0–3, each owned by the settler's own EVM address; `dataHash = keccak256(role ‖ ed25519 pubkey ‖ ENS fqn)`):

| tokenId | settler | owner | tx |
|---|---|---|---|
| 0 | sonnet | 0xA783… | [`0x01504f51…`](https://chainscan-galileo.0g.ai/tx/0x01504f51e4fd3cf27296fec2fa6b562c11a149210e75c70e0f7703971c19ac7a) |
| 1 | haiku | 0x6E8b… | [`0xadfcf922…`](https://chainscan-galileo.0g.ai/tx/0xadfcf922750b4e8cb41b9a0f7daca9b695460fcead65868d8dbfb1ca05683aca) |
| 2 | gemini | 0x0f09… | [`0x83361c7f…`](https://chainscan-galileo.0g.ai/tx/0x83361c7fdeb5636a0c2506b534abfc8db5386d901deb5772e38654fbff50739f) |
| 3 | opus | 0x44e7… | [`0x8039cee0…`](https://chainscan-galileo.0g.ai/tx/0x8039cee026ec75680a7ee664e8ace968f740151b14ec00fd5baf60ae75cbf80b) |

**Live transfer demonstration**: we executed an actual ERC-7857 `transfer()` on token #0 from settler-a to a fresh receiver wallet. Tx: [`0xa2805f44…3ab4c04`](https://chainscan-galileo.0g.ai/tx/0xa2805f447c1865f347786fd51aba0fc53f60b79816ab815ceeaa7d4843ab4c04) (block 31098066). The standard ERC-7857 mint and transfer flows work on our deployment with a stub `IERC7857DataVerifier` (returns `isValid=true`) — the contract surface is in place; full sealed-key + receiver-signed accessibility proof per the spec is v1.1 work.

**Honest scope (v1) — iNFT layer:** this deployment uses a stubbed `IERC7857DataVerifier` (returns `isValid=true`) rather than a real TEE attestation, and the dataHash binds settler identity (role + ed25519 pubkey + ENS subname) — it does not yet carry an encrypted intelligence payload via the full sealed-key flow. The iNFT is therefore an **identity-binding layer**, not an encrypted-intelligence transfer primitive in v1. Both the real verifier and the sealed-key encrypted payload are explicit v1.1 work in the README's `Scope boundary — v1 vs v1.1` section — the contract surface is in place and the standard mint + transfer flows work end-to-end today. We chose to ship a real ERC-7857 deployment with honest scope rather than a half-finished encryption pipeline behind a marketing claim.

### The full swarm identity stack
- **Gensyn L2** (chain 685689) — 70+ on-chain settlement records (canonical outcome, signed votes)
- **0G Storage Galileo** — 175 KB+ of full deliberation transcripts, HTTP-retrievable
- **0G Chain Galileo** (chain 16602) — 4 ERC-7857 iNFTs (token IDs 0–3), settler identity layer
- **Ethereum mainnet ENS** — bootloader + agent subnames + transferable judgment NFTs
- **83 tests across Python + Foundry + SDK** (37 Python protocol/identity/consensus/onchain/proof-verifier including v2 reasoning-hash binding and canonical-confidence regression; 37 Solidity Foundry including 256-run fuzz; 9 TypeScript SDK smoke tests against the live deployment)

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
