# Where Synod fits in the oracle landscape

Synod is one of several "decentralized oracle" patterns in the wild. This doc compares Synod against the closest neighbors so you can place it correctly: it's not a price oracle, not a generic compute network, and not a human-judged truth market.

## At a glance

| | Synod | Chainlink Functions | UMA Optimistic Oracle | Pyth | Reality.eth | Bittensor |
|---|---|---|---|---|---|---|
| What it answers | Multi-model AI consensus on a question | Off-chain compute called from a contract | Optimistically-asserted statements with human dispute | Real-time price feeds | Crowdsourced human Q&A | ML inference market |
| Who answers | N AI agents (LLMs) | Centralized DON nodes running your script | Anyone who asserts; humans dispute | Wormhole-bridged price publishers | Wallet holders | Miner subnets |
| Source of truth | Cryptographic quorum of independent AI signers | DON majority | Asserter unless successfully challenged | Aggregated publisher feeds | Wallet vote majority | Subnet consensus |
| Settlement chain | Gensyn L2 (with on-chain registry + signed votes) | Source chain via callback | UMA's contracts | Solana + EVM bridges | Ethereum + L2 | Subtensor (own L1) |
| Receipt artifact | ENS subname `j-{hash}.synodai.eth` + 0G transcript + on-chain bundle | Tx event with response bytes | Optimistic assertion + dispute log | Oracle update tx | Q&A contract state | Subnet emissions data |
| Independent verification | Yes — anyone runs `verify_settlement.py` against on-chain bytes; ed25519 sigs + registry membership + recomputed quorum | Yes, partial — DON signature verifiable | Trust the dispute window or run a challenge | Trust publisher set | Trust majority vote | Trust subnet validators |
| Off-chain compute model | LLM inference per settler, parallel | DON-side TypeScript / sandboxed | None; just statements | Publishers post prices | None | ML training/inference markets |
| Cost per resolution | LLM API + on-chain settlement + (optional) ENS judgment subname mint | $0.20-1+ depending on compute | Bond + dispute risk | Free for consumers (publishers eat cost) | Bond + arbitration | TAO emissions |
| Bias / collusion model | Heterogeneous models reduce single-vendor bias; sortable by per-outcome quorum | DON node operator collusion is the trust assumption | Economic — challengers slash bad asserters | Publisher set integrity | Plutocratic majority | Subnet incentive design |
| Latency | ~30-60s end-to-end | 30s-2m | Hours-days for finality (dispute window) | Seconds | Hours-days | Subnet-dependent |

## Where Synod is uniquely positioned

**Compared to Chainlink Functions**: Chainlink runs YOUR script on its DON. Synod runs N independent AI judgments and the contract anchors the quorum. Chainlink trusts the DON; Synod's trust assumption is "at least N-of-M independent AI providers agree." Different threat models — Chainlink is better for deterministic compute, Synod is better for *opinion that must be defensible against single-source bias*.

**Compared to UMA Optimistic Oracle**: UMA settles on optimism plus economic challenge. Synod settles on quorum plus cryptographic verification. UMA is better when there's a clear external truth + bonding capital. Synod is better when the question is *"what would N reasonable AI models say"*, and you want a fast cryptographic record of that consensus rather than a slow economic argument.

**Compared to Pyth**: Pyth is for prices; Synod is for AI verdicts. Not competing — they could compose (a Pyth-fed market could use Synod for resolution of ambiguous outcomes Pyth doesn't price).

**Compared to Reality.eth**: Reality is human-judged. Synod is AI-judged. Use Reality for things humans evaluate well (legal interpretations, art); Synod for things AI can rank (factual recall, multi-perspective synthesis, prompt classification).

**Compared to Bittensor**: Bittensor is an ML inference market with subnet validation. Synod is a fixed-quorum consensus protocol over heterogeneous LLM endpoints. Bittensor optimizes for "best ML model wins"; Synod optimizes for "AI consensus produces a verifiable record."

## What Synod is *not*

- **Not a generic AI inference platform.** We don't run models — we coordinate signed votes from existing model APIs.
- **Not a price oracle.** We deliberate, we don't aggregate market data.
- **Not censorship-resistant in the L1 sense.** Settlers are operator-controlled today (we run all four). Roadmap: permissionless bonded settlers per `docs/ROADMAP.md` — same trust transition Eigenlayer / Symbiotic apply to AVS operators.
- **Not a replacement for UMA or Reality.eth on questions where economic challenge matters more than fast consensus.** They're complements.

## When you'd use Synod

- A prediction market needs to settle a market with no clear external feed (e.g., "did the AI model hallucinate?", "is this content authentic?").
- An on-chain governance flow wants a multi-AI advisory vote before execution.
- An agent-to-agent commerce protocol (ERC-8183 etc) needs a third-party verifier that the work was done correctly.
- A research tool wants reproducible "N AI models considered question X and answered Y, with these signed reasons" records.

## Where Synod fails today (be honest)

- **Three-of-three model agreement is not the same as truth.** LLMs trained on similar data agree on the same wrong things. We should be paired with economic challenge mechanisms for high-value resolution.
- **Settlers are operator-controlled.** No bonded slashing yet. This is roadmap.
- **No real iNFT encryption pipeline.** Stubbed verifier. Real TEE attestation is the v1.1 work.
- **Per-settler reputation is computed from gallery transcripts, not on-chain yet.** Should move to ERC-8004 soon.

## The thesis in one sentence

> Synod ships *AI Receipts*: cryptographically verifiable, ENS-addressable, 0G-anchored proofs of multi-model AI consensus, settled on Gensyn L2.

The output isn't *"the answer"* — it's *"here's what N independent AI systems thought, signed, recorded, and resolvable by anyone with a browser."* That's a different product from every other oracle in the space.
