# AI Usage Disclosure

Per ETHGlobal hackathon rules, this document records how AI tools were used to build Synod. The repository's full commit history (one push per meaningful unit of work, no end-of-hackathon dumps) corroborates the timeline below.

## Tools used

- **Claude Code** (Anthropic Opus 4.7, 1M context window) — primary coding assistant. Used to draft code under explicit human-defined specs; every change reviewed before commit.
- **Anthropic Claude API** — three model variants used at runtime: Settler A runs `claude-sonnet-4-6`, Settler B runs `claude-haiku-4-5`, Settler D runs `claude-opus-4-7` (cross-machine, on Servarica VPS in Toronto). Sonnet/Haiku were chosen over Opus on the primary box for cost efficiency.
- **Google Gemini API** (`gemini-2.5-flash`) — used at runtime as Settler C. The live swarm is **two providers across four models**, not "three providers" — Sonnet and Haiku are both Anthropic.

## What the human owned end-to-end

The architecture, the protocol design, the trade-offs, the security model, the cross-machine deployment, the recovery from real bugs, and the editorial judgment over scope are all human-owned. Specifically: per-outcome quorum (instead of plain majority), the deterministic-poster rule (lowest-hex-pubkey among voters), binding reasoning into the signed vote domain via `reasoning_hash` (the v2 protocol bump), the canonical-confidence fix that surfaced when Gemini hit 1.0 confidence, the wallet-connected mint flow with the 3-tx pattern (mint deployer-owned → `setText` multicall → `safeTransferFrom` to submitter) — those are all human-driven decisions caught and shipped under deadline pressure. The AI assisted with code drafting, doc structure, and parallel research; the human made every architectural call and personally caught failures the AI shipped: the Python↔JS canonical-JSON drift on whole-float confidence, the address-case mismatch in the SIWE-style submitter signature, the AXL `tcp_port` mismatch on settler C, the GitHub dangling-SHA residual after force-push history scrub, the OOM crash loop in the Next.js UI from unbounded log file reads. None of those were AI catches. All were human reviews of AI output.

## Human contributions: architecture, framing, demo direction

The following decisions were made by the human builder, not the AI:

1. **Project thesis pivot.** The AI's first proposal ("Cipher Council" — generic multi-agent deliberation) was rejected by the human in favour of a build that addresses Delphi's #1 architectural weakness in week one of mainnet. Two pivots happened: Cipher Council → Delphi Predictor Mesh → Synod (decentralized settlement). The human pushed back at each step demanding tighter ecosystem fit. The conversation transcript shows the AI flipping its recommendation three times under human pressure-testing.
2. **Sponsor strategy.** Initial human direction was AXL-only depth. After the AXL core stabilised the human reopened scope to ENS (Best Integration + Most Creative) and 0G (Swarm track) — but only because each addition is **load-bearing in the protocol**, not bolted on for prize-chasing: ENS is the runtime bootloader, ENS subnames are the agent identity layer, judgment subnames are the receipt primitive, and 0G Storage is the persistent transcript memory plus the iNFT identity layer on 0G Chain. Human held the line on dropping Uniswap and KeeperHub tracks because they would have required forced integration without organic protocol fit.
3. **Heterogeneity scope decision.** When the AI proposed a 5-vendor heterogeneous settler swarm, human cut the live demo scope first, then restored provider adapters once the AXL/on-chain core was stable. The shipped live swarm runs **two providers** across **four model variants**: Anthropic `claude-sonnet-4-6` (Settler A), Anthropic `claude-haiku-4-5` (Settler B), Google `gemini-2.5-flash` (Settler C), and Anthropic `claude-opus-4-7` (Settler D, on a separate VPS in Toronto). Heterogeneity is real on the model/vendor axis. Per-role specialization (analyst / skeptic / synthesizer) was discussed but not implemented — all settlers use the same SYSTEM_PROMPT in v1. OpenAI is supported by the provider abstraction but kept off the live demo for cost.
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
- **Drive the demo narrative.** "Watch a vendor-diverse AI settler swarm reach consensus across machines, then settle a real market" is human-authored framing.
- **Verify ecosystem fit.** Human pushed for deep verification of Delphi's settler interface before locking the spec — this verification flipped the entire demo plan.

## Bug fixes the human caught

The AI's first attempts had several real bugs the human had to flag and direct fixes for:

1. **Bash sourcing of `.env` files broke on paths containing spaces** (the `Github files` directory). Human directed the rewrite to inline env var pass-through.
2. **`recordSettlement` reverted on anvil** because of a hardcoded gas limit too small for the signed-votes payload write. Human directed the simulate-first + estimate_gas pattern.
3. **TypeScript narrowing issues** in `lib/log-parser.ts` (variable narrowed to `never` due to control-flow). Human caught the silent `prev: ConsensusView | null` annotation requirement.
4. **Windows `Expand-Archive` silently corrupted the Go zip extraction** (matched SHA256, missing 9 of 55 src directories). Human caught it and directed switching to `tar.exe`.
5. **AXL `tcp_port` semantics** — the official docs example uses mismatched ports between nodes. The AI accepted the docs at face value initially; human verification of the actual Go source code revealed all peers must share the same `tcp_port`.

## Cost & spend

- Anthropic API spend through Day 8: under $1 of the $25 budget (49 settled questions live + dev-test inference). Sonnet-default was a deliberate cost decision.
- Google Gemini API: free tier (`gemini-2.5-flash` quota covers Settler C's traffic with headroom).
- All other tools: free / open source.

## License of AI-produced code

All AI-assisted code in this repository is released under MIT, consistent with the project [LICENSE](./LICENSE).
