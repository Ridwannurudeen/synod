# AI Usage Disclosure

Per ETHGlobal hackathon rules, this document records how AI tools were used to build Synod. The repository's full commit history (one push per meaningful unit of work, no end-of-hackathon dumps) corroborates the timeline below.

## Tools used

- **Claude Code** (Anthropic Opus 4.7, 1M context window) — primary coding assistant. Used to draft code under explicit human-defined specs; every change reviewed before commit.
- **Anthropic Claude API** (`claude-sonnet-4-6`) — used at runtime as the settler model. Sonnet was chosen over Opus for cost efficiency (5× cheaper, indistinguishable quality on JSON-structured outputs).

## Human contributions: architecture, framing, demo direction

The following decisions were made by the human builder, not the AI:

1. **Project thesis pivot.** The AI's first proposal ("Cipher Council" — generic multi-agent deliberation) was rejected by the human in favour of a build that addresses Delphi's #1 architectural weakness in week one of mainnet. Two pivots happened: Cipher Council → Delphi Predictor Mesh → Synod (decentralized settlement). The human pushed back at each step demanding tighter ecosystem fit. The conversation transcript shows the AI flipping its recommendation three times under human pressure-testing.
2. **Sponsor strategy.** Human chose to optimise for AXL prize alone with depth, rejecting the option to spread thinly across 3 partner prizes. Decision based on the judging criteria (Technicality + Practicality + Depth-of-Integration favour focus over spread).
3. **Heterogeneity scope decision.** When the AI proposed a 5-vendor heterogeneous settler network, human cut the live demo scope first, then restored provider adapters once the AXL/on-chain core was stable. The shipped code supports Anthropic, OpenAI, and Gemini providers, while the default demo remains Anthropic-only for cost control.
4. **Build vs portfolio.** Human explicitly instructed the AI to drop all reuse from prior projects, forcing a fresh-build per ETHGlobal "Start Fresh" rule. The AI started leaning on the human's prior IP (Beacon, ArcKit, SentinelNet, Vibe-Check) and was redirected.
5. **Critical Delphi verification.** Human flagged the technical risk that the Delphi settler interface might be permissioned and demanded verification before committing. That investigation produced the spec pivot from "live Delphi settler plug-in" to "parallel-run reference implementation with own SynodRegistry", which is what shipped.
6. **Memory and rules discipline.** Human instructed the AI to persist hackathon rules and project state to memory so they bind across the build, and required incremental commits per ETHGlobal rules.
7. **Cost discipline.** Human capped the API budget and required adequate-and-wise spending. The AI defaulted the model to Sonnet 4.6 in response, and total Anthropic spend through Day 4 stayed under $1 of the $25 budget.

## Spec and planning artifacts

- [`docs/spec.md`](./docs/spec.md) — architecture and protocol spec, written Day 1 and updated as decisions firmed up.
- The repository's commit history is the planning artifact; each commit message captures one decision-and-implementation step.

## How AI was used per layer

| Layer | AI involvement |
|---|---|
| AXL protocol research, Delphi SDK research | AI ran parallel doc fetches against Gensyn / Delphi / Foundry; human chose what to verify based on risk |
| Settler protocol design (canonical JSON, ed25519 signing, weighted majority) | AI drafted under human-stated spec; human rejected the AI's first attempt at multi-vendor heterogeneity in Day 2 |
| `SynodRegistry.sol` | AI drafted; human reviewed; human caught the gas-limit bug in `submit_settlement` (causing reverts) and directed the simulate-first fix |
| Next.js live viewer | AI drafted; human gave high-level UX direction (settler cards, status colours, on-chain tx panel) |
| Demo orchestration | AI drafted; human directed the env-var pass-through pattern after a path-with-spaces shell-source bug surfaced |

## What AI did NOT do

- **Choose the project.** The AI proposed three different concepts in sequence; the human pivoted each time until the build matched the human's strategic read of the ecosystem.
- **Make the sponsor selection.** Human read the ETHGlobal rules and decided on the single-sponsor strategy.
- **Drive the demo narrative.** "Watch 5 AI models reach consensus across machines, then settle a real market" is human-authored framing.
- **Verify ecosystem fit.** Human pushed for deep verification of Delphi's settler interface before locking the spec — this verification flipped the entire demo plan.

## Bug fixes the human caught

The AI's first attempts had several real bugs the human had to flag and direct fixes for:

1. **Bash sourcing of `.env` files broke on paths containing spaces** (the `Github files` directory). Human directed the rewrite to inline env var pass-through.
2. **`recordSettlement` reverted on anvil** because of a hardcoded gas limit too small for the signed-votes payload write. Human directed the simulate-first + estimate_gas pattern.
3. **TypeScript narrowing issues** in `lib/log-parser.ts` (variable narrowed to `never` due to control-flow). Human caught the silent `prev: ConsensusView | null` annotation requirement.
4. **Windows `Expand-Archive` silently corrupted the Go zip extraction** (matched SHA256, missing 9 of 55 src directories). Human caught it and directed switching to `tar.exe`.
5. **AXL `tcp_port` semantics** — the official docs example uses mismatched ports between nodes. The AI accepted the docs at face value initially; human verification of the actual Go source code revealed all peers must share the same `tcp_port`.

## Cost & spend

- Anthropic API spend through Day 4: ~$0.10 (≈30 inference calls during dev test runs).
- All other tools: free / open source.

## License of AI-produced code

All AI-assisted code in this repository is released under MIT, consistent with the project [LICENSE](./LICENSE).
