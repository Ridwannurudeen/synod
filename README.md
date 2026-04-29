# Synod

> Decentralized AI settlement network for Delphi — a Gensyn AXL prize entry for [ETHGlobal Open Agents](https://ethglobal.com/events/openagents).

When one AI calls the outcome, you trust one company. With Synod, you trust a network.

## The problem

Gensyn launched [Delphi](https://blog.gensyn.ai/delphi/) on mainnet on April 22, 2026 — *AI-settled information markets* on the Gensyn L2 (chain id `685689`). At market creation, the creator picks one or more AI models to act as the settlement oracle, and the model weights are fixed for that market's lifetime ([source](https://docs.gensyn.ai/tech/delphi-sdk/methods)).

That's a single point of trust. Pick a biased or hallucinating model, and the market resolves wrong with no recourse. Other prediction markets solved this with decentralized human oracles (UMA, REP). **Delphi has no decentralized AI oracle today.**

Synod is the missing piece.

## What Synod does

A network of heterogeneous AI settler nodes, each running a different model (Claude, GPT-4, Gemini, Llama, ...), independently runs inference on a market resolution prompt, signs the answer with its [Gensyn AXL](https://docs.gensyn.ai/tech/agent-exchange-layer) ed25519 identity key, exchanges signed votes over AXL's encrypted P2P mesh, computes confidence-weighted majority consensus, and posts the quorum-signed result on-chain to `SynodRegistry` on Gensyn L2.

The registry stores the full bundle of signed votes as raw bytes. **Anyone** can re-verify the quorum off-chain by reconstructing each vote's canonical-JSON signing payload and checking the ed25519 signature against the settler's registered AXL pubkey.

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
   │  Claude Sonnet   │    │  GPT-4o          │    │  Llama 3 70B     │
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
- ✅ Quorum-signed `recordSettlement` on a real EVM chain (anvil reference; mainnet config one-line switch)
- ✅ Question auto-propagation across the settler mesh
- ✅ Deterministic designated-poster (no double-submission, no coordination required)
- ✅ Live deliberation viewer (Next.js)
- ✅ One-command demo orchestrator
- ✅ **40 tests green** (13 Python protocol/identity/consensus + 7 Python on-chain helpers + 20 Solidity Foundry incl. 256-run fuzz)

## Quick start

Prerequisites: Node 22+, Go 1.25.5+ (auto-fetched via `GOTOOLCHAIN`), Foundry, Python 3.11+.

```bash
# 1. Build the AXL daemon
git clone https://github.com/gensyn-ai/axl
cd axl && GOTOOLCHAIN=go1.25.5 go build -o ../axl/axl-node ./cmd/node/

# 2. Build SynodRegistry (anvil) + run Foundry tests (20 pass)
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

## Running just the on-chain integration test

Without the UI, to verify the protocol end-to-end on a local chain:

```bash
bash settler/tools/run_onchain_test.sh
# Expected output:
#   Settlement: (questionId, outcome=1, quorumSize=2, weightedScoreScaled=1940000, ...)
#   ONCHAIN INTEGRATION OK
```

## Mapping to ETHGlobal judging criteria

| Criterion | What Synod brings |
|---|---|
| **Technicality** | Multi-LLM consensus protocol; ed25519-signed canonical-JSON vote payloads; P2P over Yggdrasil mesh; on-chain audit trail; deterministic designated-poster algorithm |
| **Originality** | First decentralized AI settlement service. The category does not exist yet — Polymarket has UMA, Augur has REP, Delphi had nothing |
| **Practicality** | Solves Delphi's actual #1 architectural weakness in week-one of mainnet. Reference implementation Gensyn could integrate as Delphi v2's settler architecture |
| **Usability (UI/UX/DX)** | Live deliberation viewer; one-command demo orchestrator; gitignored env template; ` forge test` + `pytest` round-trip in seconds |
| **WOW factor** | Watch heterogeneous AI models on independent machines reach quorum-signed agreement, with the on-chain transaction hash appearing on the same screen |

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
- All Synod settler agent code (Python, ~600 LOC)
- Synod deliberation protocol & canonical JSON signing
- `SynodRegistry.sol` + Foundry test suite + deploy script (~470 LOC Solidity)
- On-chain submission client (web3.py wrapper) + designated-poster algorithm
- Next.js live deliberation viewer (~700 LOC TS)
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
