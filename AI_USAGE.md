# AI Usage Disclosure

Per ETHGlobal hackathon rules, this document records how AI tools were used to build Synod. Updated continuously across the hackathon.

## Tools used

- **Claude Code** (Anthropic Opus 4.7, 1M context window) — primary coding assistant.
- **Anthropic Claude API** (`claude-opus-4-7`) — used at runtime as one of Synod's settler models.
- **OpenAI API** — used at runtime as a Synod settler model.
- **Google Gemini API** — used at runtime as a Synod settler model.

## Human contributions (architectural decisions, problem framing, demo direction)

The following decisions were made by the human builder, not the AI:

- **Project thesis**: identified that Delphi's single-AI-settler model is its #1 architectural weakness in week one of mainnet, and decided to build a decentralized settlement service. The AI's earlier proposed concept (a generic agent deliberation network without ecosystem hook) was rejected by the human in favor of one tightly fitted to Gensyn's just-launched flagship product.
- **Sponsor strategy**: chose to optimize for AXL prize alone with depth, rejecting the option to spread thinly across 3 partner prizes. Decision based on the judging criteria (Technicality + Practicality + Depth-of-Integration favor focus over spread).
- **Build vs portfolio**: instructed AI explicitly to drop all reuse from prior projects (Beacon, ArcKit, SentinelNet, Vibe-Check), forcing a fresh-build per ETHGlobal "Start Fresh" rule.
- **Decision to verify Delphi settler interface before committing demo plan**: identified the technical risk that determines whether the demo can show real on-chain mainnet settlement vs reference-implementation framing.
- **Memory and repeatability discipline**: instructed AI to persist hackathon rules and project state to memory so they bind across the build.

## Spec and planning artifacts

- [`docs/spec.md`](./docs/spec.md) — architecture and protocol spec (forthcoming, Day 1)
- Conversation transcripts driving each decision are referenced inline in commits.

## How AI was used

- **Research & verification**: AI ran parallel research across Gensyn / Delphi / AXL / KeeperHub / 0G docs to verify ecosystem fit before code was written.
- **Code generation**: AI drafted protocol implementations under explicit human-defined specs. All code was reviewed and adjusted before commit.
- **Documentation**: AI drafted README, this AI_USAGE.md, and the spec, all under human-supplied direction on framing and emphasis.

## What AI did NOT do

- Choose the project. The human pivoted the AI's first two proposals (Cipher Council → Delphi Predictor Mesh → Synod) until the proposal matched the human's strategic read of the ecosystem.
- Make sponsor selection. The human read the ETHGlobal rules and decided on the single-sponsor strategy.
- Drive demo direction. Demo narrative ("watch 5 AI models reach consensus across machines, then settle a real Delphi market") is human-authored.

This document will be updated continuously as the project evolves.
