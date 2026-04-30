# ENSIP-DRAFT: AI Agent Identity in ENS

| Item | Value |
| --- | --- |
| Status | Draft (informal) |
| Created | 2026-04-30 |
| Author | @Ridwannurudeen (Synod) |
| Discussion | TBD — to be opened on https://discuss.ens.domains |
| Reference implementation | [synod](https://github.com/Ridwannurudeen/synod) — live on mainnet at `synodai.eth` |

## Abstract

This proposal specifies a convention for representing autonomous AI agents (and groups thereof) in ENS. It defines:

1. A **parent name** as the root identity for a coordinated agent network, holding shared configuration as text records.
2. **Role-bearing subnames** that identify individual agents, with text records carrying their cryptographic identity, role string, and parent reference.
3. **Judgment subnames** that record outcomes of agent consensus events as transferable, queryable artifacts.

The schema is fully expressible via existing ENS PublicResolver text records (no new resolver functions required) and works on mainnet, L2 (ENS-on-L2 / DNSSEC), and offchain CCIP-resolved names.

## Motivation

As AI agents become first-class onchain actors, three distinct identity needs arise:

1. **Discovery**: a user or another agent must be able to resolve "who is agent X" — its address, role, model, capabilities — without trusting a centralized registry.
2. **Verification**: a relying party must be able to confirm that a message claiming to be from agent X was indeed signed by it, by resolving its public key from a trusted source.
3. **Provenance of decisions**: when N agents reach a consensus on something (an oracle outcome, a multi-party signature, a coordinated action), there must be a stable, transferable, addressable record of *what was decided* — not just *who is in the network*.

ENS already solves (1) and (2) for human-controlled wallets via primary names + text records. This proposal extends the convention so that AI-agent networks can self-describe in the same surface.

## Specification

### Parent record schema (`agentnetwork.eth`)

A parent ENS name representing an AI agent network MAY set the following text records on its PublicResolver:

| Key | Value | Required | Notes |
| --- | --- | --- | --- |
| `synod.registry` | `0x…` (address) | yes | The on-chain contract that holds canonical agent membership, settlement state, etc. |
| `synod.chain-id` | uint as decimal string | yes | Chain id where `synod.registry` lives. |
| `synod.rpc` | RPC URL | yes | Public RPC against which the registry can be read. |
| `synod.threshold` | uint as decimal string | recommended | The minimum quorum size for consensus events. |
| `synod.verify-url` | URL | optional | A web UI or HTTP endpoint where settlements can be independently verified. |
| `synod.network-url` | URL | optional | A live network/topology view. |
| `url`, `description`, `com.github` | per ENSIP-5 | recommended | Standard ENSIP-5 metadata. |

A consuming client MUST be able to bootstrap from `agentnetwork.eth` alone — that is, given only the parent name, it can resolve the registry contract address, RPC, and chain id and then proceed to load on-chain state.

### Subname record schema (`agent.agentnetwork.eth`)

Each agent in the network is represented by a subname under the parent. The subname's PublicResolver MUST set:

| Key | Value | Required | Notes |
| --- | --- | --- | --- |
| `addr` (coin type 60) | the agent's EVM address | yes | Where the agent posts on-chain. |
| `synod.role` | free-form role string | yes | E.g. `"anthropic-claude-sonnet-4-6"`, `"validator-eu-1"`. |
| `synod.pubkey` | 32-byte hex (no 0x) | yes | The agent's ed25519 (or other) signing public key for off-chain message verification. |
| `synod.parent` | parent ENS name | yes | Backpointer for offline indexing. |
| `synod.capabilities` | comma-separated tags | optional | E.g. `"vision,reasoning,multi-lingual"`. |

A relying party verifying a signed message from `agent.agentnetwork.eth`:

1. Resolves the subname's `addr` and `synod.pubkey`.
2. Looks up the on-chain registry tuple at `synod.registry` (from parent) using `addr`.
3. Confirms the on-chain `axlPubKey` (or equivalent) matches the ENS `synod.pubkey`.
4. Verifies the signature against `synod.pubkey`.

A pubkey mismatch between ENS and the registry MUST be treated as identity compromise.

### Judgment-subname schema (`j-{hash}.agentnetwork.eth`)

When the network produces a verifiable consensus event (an "AI judgment"), it MAY mint a judgment subname carrying the verdict in text records. This makes the judgment *queryable* (by name) and *transferable* (NameWrapper-wrapped subnames are NFTs).

Recommended schema:

| Key | Value | Notes |
| --- | --- | --- |
| `addr` | owner address | The recipient/consumer of the judgment. |
| `synod.outcome` | the canonical outcome label | E.g. `"yes"`, `"approve"`, `"3.14"`. |
| `synod.quorum` | `"N/M"` | Number of votes for the winning outcome over total agents. |
| `synod.weighted-score` | scaled integer | Confidence/score scaled by 10^6 (or as documented in `synod.score-scale`). |
| `synod.transcript-cid` | content identifier | Pointer to off-chain full transcript (IPFS, 0G Storage root, Arweave, etc). |
| `synod.tx` | settlement tx hash | The on-chain submission. |
| `synod.question` | truncated prompt or hash | Human-readable summary of what was decided. |
| `synod.parent` | parent ENS name | |
| `description` | narrative summary | Per ENSIP-5. |

The label format `j-{hash}` is a recommendation; implementations MAY use any URL-safe label as long as it is collision-free per parent.

### Resolution

All records resolve via the standard ENS resolution path: namehash(name) → `Registry.resolver(node)` → `Resolver.text(node, key)`. No new resolver function is introduced.

## Reference: live deployment

A live reference implementation is available at `synodai.eth` on Ethereum mainnet:

- **Parent**: `synodai.eth` — deployed via the v3 Registrar Controller on 2026-04-29 (tx [`0x0a03a96…1b74357f`](https://etherscan.io/tx/0x0a03a9615ee8cfe49cf84fcea4f354420002393ba62870ff280c5f231b74357f)). Resolver: PublicResolver `0x231b…E63`. All parent records described above are set.
- **Subnames**: `settler-a.synodai.eth`, `settler-b.synodai.eth`, `settler-c.synodai.eth` — each resolves to a distinct EVM address + role + ed25519 pubkey. Consuming UI: https://synod.gudman.xyz/network bootstraps purely from these records.
- **Public profile API**: `GET https://synod.gudman.xyz/api/agent/{ensName}` — composes ENS + on-chain + live AXL data.

## Rationale

### Why text records, not new resolver methods?

Text records work today on every PublicResolver, every wallet, every block explorer, every name-aware tool. A new resolver method would require:

- Per-resolver redeployment
- Wallet/explorer support
- Indexer support (subgraph, etc)

Text records are zero-cost in tooling and immediately portable.

### Why a parent + subnames split?

One ENS name per agent is expensive and fragmented. A parent + subnames split:

- Centralizes the *configuration* surface so consumers can bootstrap from one name.
- Decentralizes the *identity* surface — each agent has its own subname, controllable by its own key (NameWrapper supports per-subname owners).
- Makes the network discoverable: enumerate all `*.agentnetwork.eth` subnames to enumerate all agents.

### Why judgment-subnames vs. raw IPFS / EAS attestations?

Existing attestation schemes (EAS, on-chain logs, IPFS metadata) are good for machine-to-machine but poor for *human resolution*. With judgment-subnames:

- A user can paste `j-abc.synodai.eth` into ENS app, OpenSea, any block explorer, and see the verdict.
- The subname is transferable (the question's submitter can sell or hand off the judgment).
- Royalty and resale primitives that already exist for ENS subnames (NameWrapper, OpenSea collections) come for free.
- The subname is *queryable* — `Registry.resolver(node).text(node, "synod.outcome")` works from any EVM contract on mainnet without bridges.

## Backwards compatibility

This proposal introduces no new resolver functions or contract changes. It is fully compatible with existing ENS infrastructure. Names that don't follow the schema will resolve and be treated as ordinary names; names that do follow it gain richer semantics for AI-agent-aware clients.

## Reference implementation

- Synod settler agents: [`synod/settler/synod_settler/agent.py`](https://github.com/Ridwannurudeen/synod) (Python, ed25519, Gensyn AXL transport)
- Settler boot path that consumes `synodai.eth` records: [`synod/ui/lib/ens.ts`](https://github.com/Ridwannurudeen/synod) (TypeScript, viem)
- Judgment-subname minting tool: [`synod/settler/tools/mint_judgment.py`](https://github.com/Ridwannurudeen/synod)

## Open questions

1. **Schema namespace.** This draft uses `synod.*` prefixes. A more general standard might converge on `agent.*` or `aiagent.*`. Naming is bikesheddable; the underlying semantics are not.
2. **Pubkey algorithms.** Today we specify ed25519 since it's our native choice for AXL transport. A `synod.pubkey-alg` text record could disambiguate (`ed25519`, `secp256k1`, `bls12-381`, etc.) for future agents using different schemes.
3. **Capability semantics.** `synod.capabilities` is intentionally free-form for now; a future ENSIP could pin a controlled vocabulary.
4. **Reverse resolution.** Should each agent's EVM address have a primary name (`addr → fqn`)? On L1 this is expensive (~$3 per address). On L2 ENS or with DNSSEC, this becomes cheap and worth standardizing.

## Acknowledgements

This draft was developed during ETHGlobal Open Agents (Apr 2026). Thanks to the ENS team for the v3 Registrar Controller (which made deploying this on a fresh name affordable) and to the Gensyn team for AXL (which made multi-machine agent identity testing tractable).
