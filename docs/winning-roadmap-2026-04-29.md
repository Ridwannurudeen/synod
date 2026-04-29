# Synod Winning Roadmap - Deep Assessment

Date: 2026-04-29

This is a code-grounded assessment of what Synod needs to become both
hackathon-competitive and credible for a Gensyn Foundation grant.

## External bar

The Gensyn AXL prize is not a generic agent prize. The official prize page
prioritizes:

- depth of AXL integration
- quality of code
- clear documentation
- working examples
- communication across separate AXL nodes, not just in-process
- real utility, not just novelty

The same page says all winners are fast-tracked into the Gensyn Foundation grant
program. That means Synod must look like infrastructure Gensyn could plausibly
adopt, not only a working demo.

AXL's own positioning is about agents reaching each other across machines
without public HTTP endpoints, reverse proxies, central brokers, or custom
network infrastructure. Synod has a strong match here because settlement nodes
really do need decentralized peer-to-peer communication.

Delphi's docs describe markets where models are evaluated over rounds, prices
move as new performance information arrives, and settlement rewards users who
back the winning model. Synod's best grant story is therefore not "prediction
market UI"; it is "the decentralized settler layer Delphi will need as value
increases."

Sources:

- https://ethglobal.com/events/openagents/prizes
- https://blog.gensyn.ai/introducing-axl/
- https://docs.gensyn.ai/intelligence-market/what-is-delphi
- https://docs.gensyn.ai/intelligence-market/trading-markets-and-tokens

## Brutal current verdict

Synod is technically stronger than most hackathon projects because it already
has:

- real AXL message transport
- multiple settler processes
- three provider adapters
- ed25519 vote signing using AXL identity keys
- quorum-gated consensus
- deterministic designated poster
- on-chain proof anchoring
- Python and TypeScript proof verifiers
- Solidity tests and Python protocol tests
- a one-command demo path

But it is not yet as grant-grade as the story claims. The current system proves
"a signed-vote quorum can be anchored and independently verified." It does not
yet prove "the chain itself rejects invalid settlement quorums." That distinction
matters.

Current rating:

| Dimension | Current | With recommended P0/P1 work |
|---|---:|---:|
| Gensyn AXL prize fit | 7.5/10 | 9/10 |
| Technical depth | 7.5/10 | 9/10 |
| Demo clarity | 6.5/10 | 9/10 |
| Grant credibility | 5.5/10 | 8.5/10 |
| Security/trust model | 6/10 | 8.5/10 |
| Reproducibility | 7/10 | 9/10 |

## Critical gap 1: chain anchoring is not chain verification

Code reference:

- `contracts/src/SynodRegistry.sol`
- `settler/synod_settler/proof_verifier.py`
- `ui/lib/proof-verifier.ts`

Current behavior:

- `recordSettlement` checks caller is a registered settler.
- It checks nonzero question id, quorum bounds, and proof payload size.
- It stores the signed-vote payload immutably.
- Off-chain verifiers check ed25519 signatures, registered AXL pubkeys, quorum,
  weighted score, and domain binding.

Why this is a grant problem:

A malicious or compromised registered settler can call `recordSettlement` with a
bad outcome and arbitrary proof bytes as long as the payload is nonempty and
under the size cap. The UI/CLI verifier will mark it invalid, but the question
is still sealed on-chain. For a hackathon demo this can be explained. For a
real settlement layer, it is not enough.

Best implementation:

Add a second settlement path that the contract can verify natively:

```solidity
recordVerifiedSettlement(
    bytes32 questionId,
    bytes32 promptHash,
    bytes32 outcomesHash,
    uint256 deadline,
    uint8 outcome,
    VerifiedVote[] calldata votes,
    bytes calldata ed25519Payload
)
```

Where each `VerifiedVote` includes:

```solidity
struct VerifiedVote {
    address settler;
    bytes32 axlPubKey;
    uint8 outcome;
    uint32 confidenceBps;
    uint64 timestamp;
    bytes evmSignature;
}
```

Each settler signs the same vote domain twice:

- ed25519 signature with AXL identity, used by off-chain verifiers to prove AXL
  identity continuity
- EIP-712/ECDSA signature with registered EVM key, used by the contract to
  enforce quorum on-chain

The contract can then:

- recover each registered settler address with `ecrecover`
- check the settler's registered AXL pubkey matches the vote
- deduplicate settlers
- reject timestamps after deadline
- recompute winner vote count
- recompute weighted score from `confidenceBps`
- seal only if the claimed outcome actually reaches quorum

This is the strongest possible grant upgrade. It turns Synod from "off-chain
proof anchored on-chain" into "on-chain enforceable quorum plus off-chain AXL
signature audit."

Hackathon effort:

- Medium/high risk, high reward.
- Implement if there is enough time after demo reliability work.
- If too risky, document it as the explicit grant milestone and keep the CLI/UI
  verifier front-and-center.

## Critical gap 2: AXL is real, but not visually proven enough

Code reference:

- `settler/synod_settler/axl_client.py`
- `tools/demo-up-3node.sh`
- `ui/app/api/state/route.ts`
- `ui/lib/log-parser.ts`
- `ui/app/page.tsx`

Current behavior:

- Settlers use AXL `/send` and `/recv`.
- UI mostly reconstructs state from log files.
- UI probes only the primary AXL daemon directly.
- The three-node script runs local AXL nodes by default.

Why this is a hackathon problem:

The prize explicitly requires separate AXL nodes. Judges should see proof of
that in the UI, not infer it from docs or shell logs.

Best implementation:

Add an "AXL Mesh Proof" panel.

It should show one row per node:

- node label: A, B, C
- machine: local laptop, VPS, remote peer
- AXL API URL
- AXL pubkey
- AXL IPv6 if topology exposes it
- provider/model
- registered EVM address
- latest sent/received message timestamp
- vote accepted/rejected status
- on-chain registration status

Implementation details:

- Extend `.synod-demo-runtime.json` to include all AXL endpoints, model tags,
  EVM addresses, and labels.
- Add `ui/app/api/topology/route.ts` that probes every configured AXL endpoint.
- Add `TopologyNodeView` types in `ui/lib/types.ts`.
- Render a first-screen mesh panel before the settler cards.
- Log send byte counts from `AxlClient.send` so the UI can show real message
  movement.

This is the most direct AXL-prize improvement.

## Critical gap 3: current consensus finalizes too early for real markets

Code reference:

- `settler/synod_settler/agent.py`
- `settler/synod_settler/consensus.py`

Current behavior:

- Once the number of stored votes reaches quorum, a node immediately computes
  consensus and emits once.
- With a 2-of-3 quorum, the first two matching votes can finalize before the
  third arrives.

Why this matters:

Fast finality is good for a demo, but settlement infrastructure usually needs a
deliberation/finality policy:

- wait until all registered voters respond
- or wait until a minimum deliberation time elapses
- or finalize immediately only on supermajority/unanimity
- or finalize at deadline

Without this, a slow but correct high-quality model can be ignored.

Best implementation:

Add finality modes:

```text
fast_quorum        current demo behavior
deadline          wait until deadline or all votes
supermajority     finalize early only if winner cannot be overturned
unanimous_fast    finalize early only if all received votes agree and all are present
```

For the hackathon demo, use `fast_quorum` or `supermajority`.

For grant story, show `deadline`/`supermajority` as production modes.

## Critical gap 4: votes do not commit to evidence

Code reference:

- `settler/synod_settler/protocol.py`
- `settler/synod_settler/llm.py`
- `settler/synod_settler/proof_verifier.py`

Current behavior:

Signed votes bind to:

- protocol version
- question id
- prompt hash
- outcomes hash
- deadline
- settler pubkey
- model tag
- outcome
- confidence
- timestamp

They do not bind to:

- source URLs
- source fetch timestamps
- evidence hashes
- model reasoning hash
- citation bundle

Why this matters:

Settlement disputes are usually about evidence, not only the final answer. A
grant reviewer will ask: "What exactly did each model see before voting?"

Best implementation:

Add `evidence_hash` and optional `evidence` metadata to `QuestionAnnouncement`.

Example:

```json
{
  "market_ref": "delphi:market:...",
  "source_urls": ["https://..."],
  "source_hashes": ["sha256:..."],
  "fetched_at": 1777480000,
  "evidence_summary_hash": "..."
}
```

The signed vote should include `evidence_hash`. The on-chain payload should
store the full evidence manifest. The UI should show:

- prompt hash
- outcomes hash
- evidence hash
- source count
- source timestamps

This makes Synod feel like a serious oracle, not only multi-LLM voting.

## Critical gap 5: no generic proof explorer

Code reference:

- `settler/tools/verify_settlement.py`
- `ui/lib/proof-verifier.ts`
- `ui/lib/registry.ts`

Current behavior:

- CLI can verify by RPC, registry, and question id.
- UI verifies only the active live demo question.

Why this matters:

The strongest claim in Synod is "anyone can verify." Judges should be able to
paste a question id and see verification without trusting the live state.

Best implementation:

Add `/verify` page:

- RPC URL
- registry address
- question id
- verify button
- result: verified/invalid
- vote table
- signature status
- registered status
- recomputed quorum
- recomputed weighted score
- raw proof download/copy

This turns the CLI verifier into a product surface.

## Critical gap 6: no tamper demonstration

Current behavior:

- Tests cover invalid signatures, weighted score mismatch, quorum mismatch, and
  duplicate/rejected cases.
- The live demo only shows success.

Why this matters:

Judges need to understand the security story quickly. A tamper demo makes the
cryptography obvious.

Best implementation:

Add proof fixtures:

- valid proof
- tampered outcome
- unregistered pubkey
- duplicate settler
- weighted score mismatch
- prompt hash mismatch

Expose them in the proof explorer as "try invalid proof" examples. This is a
small feature with high presentation value.

## Critical gap 7: demo reliability depends on live LLM keys

Current behavior:

- `tools/demo-up-3node.sh` defaults to Anthropic, OpenAI, Gemini.
- The doctor catches missing keys.
- There is no deterministic 3-node smoke path that exercises AXL + consensus +
  on-chain without spending API calls.

Best implementation:

Add a `deterministic` provider for test/demo smoke only.

Rules:

- For known factual prompts, return fixed correct answer.
- For unknown prompts, hash prompt to deterministic outcome with confidence.
- Mark model tag clearly as `deterministic-smoke-provider`.

Then add:

```bash
tools/demo-smoke-test-3node.sh
```

It should run three AXL nodes, three deterministic settlers, inject a question,
wait for consensus, verify on-chain proof, and tear down.

This improves code quality and makes judging rehearsal safer. Do not use the
deterministic provider for the final recorded demo.

## Critical gap 8: docs overclaim cross-machine deployment

Code reference:

- `README.md`
- `docs/spec.md`
- `docs/judge-demo.md`
- `tools/demo-up-3node.sh`

Current docs mention separate machines/VPS in places, but the main 3-node
script starts three local AXL nodes. That is still valid as separate AXL nodes,
but for the highest score the project should include a cross-machine recipe.

Best implementation:

Add `docs/cross-machine-demo.md`:

- machine A: laptop
- machine B: VPS
- machine C: second VPS or cloud shell
- how to copy configs
- which ports are local only
- how to exchange AXL pubkeys
- how to start each settler
- how to point UI at all AXL endpoints
- expected proof verifier output

For judging, even if live runs local, having a documented cross-machine path
shows this is real infrastructure.

## Feature decision matrix

| Feature | Hackathon value | Grant value | Risk | Build first? |
|---|---:|---:|---:|---|
| AXL Mesh Proof panel | Very high | High | Medium | Yes |
| 3-node deterministic smoke | High | Medium | Low | Yes |
| Proof Explorer | High | High | Medium | Yes |
| Evidence-bound votes | Medium/high | Very high | Medium | Yes |
| EIP-712 on-chain verified quorum | High | Very high | High | Maybe, after P0 |
| Delphi Shadow Settlement mode | Very high | Very high | Medium | Yes |
| Tamper demo fixtures | High | Medium | Low | Yes |
| Stake/slashing contract | Medium | Very high | High | Not before core proof |
| Extra LLM providers | Low/medium | Medium | Medium | No |
| Fancy landing page | Low | Low | Low | No |
| Full Delphi integration | Very high | Very high | Very high | Only if a real interface exists |

## Recommended implementation order

### Sprint 1: make the demo obviously AXL-native

1. Add runtime topology config to `.synod-demo-runtime.json`.
2. Add `/api/topology`.
3. Add AXL Mesh Proof panel.
4. Show all three nodes, not only primary AXL.
5. Add send-byte and receive timestamps to logs/UI.

Expected result:

Judges immediately see three independent AXL nodes and real message movement.

### Sprint 2: make verification a product

1. Add `/verify` page.
2. Reuse `ui/lib/proof-verifier.ts`.
3. Accept question id, registry address, RPC URL.
4. Show vote-by-vote verification.
5. Add tamper fixtures.

Expected result:

The "anyone can verify" claim becomes clickable and judge-testable.

### Sprint 3: make settlement oracle-grade

1. Add evidence manifest to question injection.
2. Add `evidence_hash` to signed vote domain.
3. Update Python verifier and TypeScript verifier.
4. Update proof payload.
5. Show evidence hash in UI.

Expected result:

Each model signs not only an answer but the evidence basis for the answer.

### Sprint 4: make it grant-grade

1. Add EIP-712/ECDSA signature over vote domain using each settler EVM key.
2. Add `recordVerifiedSettlement` to the contract.
3. Contract verifies EVM quorum and weighted score on-chain.
4. Keep ed25519 AXL signature in the payload for transport identity audit.
5. Update tests and UI proof status to distinguish:
   - on-chain quorum verified
   - ed25519 AXL proof verified

Expected result:

Synod becomes a credible decentralized settler architecture rather than only a
proof-anchoring demo.

## Hackathon demo script after upgrades

Opening line:

> Delphi proves that markets can price machine intelligence. Synod solves the
> next problem: how those markets settle without trusting one model or one
> server.

Demo beats:

1. Show AXL Mesh Proof: three nodes, three providers, three AXL pubkeys.
2. Inject a Delphi-style settlement prompt with evidence.
3. Watch each model vote independently.
4. Show quorum reached.
5. Show settlement recorded on-chain.
6. Open Proof Explorer.
7. Verify every signature and registered AXL pubkey.
8. Open tampered proof fixture and show rejection.
9. End with grant path: verified quorum today, EIP-712 on-chain quorum and
   stake/slashing next.

## What not to build now

Do not spend time on:

- a bigger landing page
- more decorative UI
- more model providers
- social sharing
- token launch mechanics
- full staking economics before the proof layer is stronger
- pretending to be fully integrated with Delphi if the settler interface is not
  publicly available

The winning path is protocol credibility, not product breadth.

## Final recommendation

The single best hackathon feature is:

> AXL Mesh Proof panel plus Proof Explorer.

The single best grant feature is:

> Dual-signed votes with on-chain EIP-712 quorum verification and off-chain
> ed25519 AXL identity verification.

If time is short, build the hackathon feature first. It directly matches the
AXL prize criteria and will make the demo much easier to understand.

If time remains, start the grant feature. Even a partial implementation with
tests and a clear contract interface would materially raise Synod's seriousness.
