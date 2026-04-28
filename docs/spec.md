# Synod — Architecture & Protocol Spec

## One-line

A network of heterogeneous AI settler nodes that coordinate over Gensyn AXL to reach cryptographic consensus on settlement outcomes for AI-settled prediction/information markets.

## Why

Gensyn launched [Delphi](https://blog.gensyn.ai/delphi/) on mainnet on April 22, 2026. Delphi resolves markets via AI models picked by the market creator at creation time. **The model weights are fixed at market creation and cannot be changed** ([source](https://docs.gensyn.ai/tech/delphi-sdk/methods)). This produces a single-model trust dependency: a creator who picks one biased or hallucinating AI model can produce wrong settlements with no recourse.

Synod replaces that single point of trust with a heterogeneous network: 5+ AI models from independent providers, each running on a separate machine, coordinating over an encrypted P2P channel (AXL), and submitting an on-chain settlement only when a quorum of distinct, signed model identities agree.

## Critical scoping decision (verified Day 1)

The public Delphi SDK (`@gensyn/delphi-sdk`) exposes only **trader/predictor methods**: `quoteBuyExactOut`, `quoteSellExactIn`, `spotPrice`, `getMarket`, `marketStatus`, `buyExactOut`, `sellExactIn`, `redeem`. **There is no exposed settler-side method** (no `submitSettlement`, no `resolveMarket`, no settler registration). Settlement is permissioned to Gensyn-internal infrastructure today.

**Implication**: Synod cannot, in this hackathon window, plug into a live Delphi market as the actual settler. Instead, Synod ships as:

1. A working multi-node consensus protocol over AXL (the AXL prize-winning core).
2. An on-chain settlement registry deployed by us on Gensyn L2 that records Synod consensus decisions with cryptographic quorum proofs.
3. A parallel-run demo: pick a real, currently-active Delphi market; run Synod's full consensus protocol against the same resolution prompt; show what Synod would have settled to; compare with what Delphi's single settler eventually decides when the market resolves.
4. A reference implementation Gensyn could integrate into Delphi v2.

This is positioned to grant committees as **infrastructure Gensyn objectively needs to ship** — the next-version settler architecture for their just-launched flagship product.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Synod Settler Network                       │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │ Settler #1   │  │ Settler #2   │  │ Settler #3   │   ...          │
│  │ Claude        │  │ GPT-4         │  │ Gemini        │                │
│  │ AXL node A    │  │ AXL node B    │  │ AXL node C    │                │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                │
│         │                  │                  │                       │
│         └─────────────── AXL P2P (encrypted, signed) ─────────────────┤
│                                  │                                    │
│                                  ▼                                    │
│                       Quorum proof (k-of-n)                          │
│                                  │                                    │
│                                  ▼                                    │
│           SynodRegistry.recordSettlement(...)  ← Gensyn L2            │
└──────────────────────────────────────────────────────────────────────┘
```

## Node roles

Every settler node is the same role architecturally — there is no leader, no coordinator. Each node:

1. Subscribes to the question stream over AXL (in v1, the question is broadcast manually; in v2, it could be triggered by a Delphi market resolution event).
2. Runs inference against its own LLM provider with the resolution prompt.
3. Constructs a `SettlementVote` message signed with its AXL ed25519 identity key.
4. Broadcasts the vote to all peers via AXL.
5. Collects votes from peers within a deadline.
6. Computes the consensus result locally (deterministic algorithm: weighted majority by confidence).
7. If a quorum threshold (e.g., 4-of-5 or 3-of-5) is reached, the node with the lowest peer ID submits the on-chain transaction; all others verify and stand by.

## Consensus protocol

### Phase 1: Question announcement
- A question payload is published to AXL on a known topic name (`synod.questions.v1`).
- Payload: `{ questionId: hex, prompt: string, deadline: unix_ts, threshold: int }`.

### Phase 2: Independent inference
- Each settler runs inference. Result includes:
  - `outcome` (binary: 0|1; multi-outcome: index)
  - `confidence` (0-1 float)
  - `reasoning` (string, optional, for audit)

### Phase 3: Signed vote broadcast
- Vote payload (canonical JSON, signed):
  ```
  {
    "questionId": "<hex>",
    "settlerKey": "<ed25519 pubkey hex>",
    "modelTag": "anthropic-claude-opus-4-7",
    "outcome": 1,
    "confidence": 0.92,
    "timestamp": <unix_ts>
  }
  ```
- Signature: `ed25519(canonical_json(payload))` using AXL identity key.

### Phase 4: Vote collection
- Each settler collects votes from N-1 peers until `deadline` or until `n` votes received.
- Votes are deduplicated by `settlerKey` (one vote per settler).
- Invalid signatures are rejected.

### Phase 5: Consensus
- Compute weighted majority: `sum(confidence_i for vote_i where outcome_i = candidate) / sum(confidence_i)` for each candidate.
- Settlement outcome = candidate with highest weighted score.
- If `count(votes_for_winner) >= threshold`, consensus is reached. Otherwise, mark as `NO_QUORUM`.

### Phase 6: On-chain submission
- Lowest-peer-ID node (deterministic across the network) submits the transaction:
  ```solidity
  SynodRegistry.recordSettlement(
    bytes32 questionId,
    uint8 outcome,
    bytes[] memory signedVotes
  );
  ```
- Contract verifies each signature corresponds to a registered settler keyset, counts the quorum, stores the result.
- All other nodes verify the on-chain submission.

## On-chain layer (Gensyn L2)

### `SynodRegistry.sol`
- `registerSettler(address settler, bytes32 axlPubKey, string modelTag)` — admin-gated, lists approved Synod settler nodes.
- `recordSettlement(bytes32 questionId, uint8 outcome, bytes[] signedVotes)` — anyone can call; verifies quorum of signed votes from registered settlers; emits `SettlementRecorded` event.
- View: `getSettlement(bytes32 questionId) returns (uint8 outcome, uint256 quorumSize, address[] settlers)`.

(v2: stake-based participation, slashing, $AI rewards. Out of scope for hackathon submission.)

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| P2P comms | Gensyn AXL (Go binary, runs as local daemon) | Prize requirement; encrypted; built-in MCP/A2A |
| Settler agent runtime | Python 3.11+ | AXL has Python sample client; Anthropic/OpenAI/Gemini SDKs are Python-native |
| Cryptography | ed25519 (via PyNaCl or cryptography lib) | AXL identity keys are ed25519 |
| Smart contracts | Solidity 0.8.24 + Foundry | Standard EVM; Gensyn L2 is OP Stack |
| L2 deployment | Gensyn L2 mainnet | Real on-chain activity, demonstrates ecosystem fit |
| LLM providers | Anthropic Claude, OpenAI GPT, Google Gemini, plus 1-2 open-source via fal/Together | Heterogeneity is the security model |
| UI | Next.js 16 + Tailwind | Fast iteration; live deliberation viewer |

## Deliberate non-goals (v1)

- Stake/slashing — recorded as v2 in the spec for grant proposal.
- Permissionless settler enrollment — admin-gated registry for v1.
- ERC-7857 iNFT settler-as-NFT — out of scope for AXL prize focus.
- Multiple market types — focus on binary first, extend to multi-outcome only if time permits.

## Hackathon plan tracking

Day-by-day execution tracked via tasks. Spec will be updated as protocol decisions are finalized.

---

*Last updated: Day 1 (April 28, 2026)*
