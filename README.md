# Synod

> Decentralized AI settlement network for Delphi.

When one AI calls the outcome, you trust one company. With Synod, you trust a network.

## What this is

Synod is a settler service for Gensyn's [Delphi](https://blog.gensyn.ai/delphi/) information markets. Today, a Delphi market is settled by AI models the creator picks at market creation — a single point of trust. Synod replaces that single point of trust with a network of heterogeneous AI models running on independent machines that coordinate over [Gensyn AXL](https://docs.gensyn.ai/tech/agent-exchange-layer) and reach cryptographic consensus before submitting a settlement.

Built for [ETHGlobal Open Agents](https://ethglobal.com/events/openagents) (April 24 – May 6, 2026).

## Architecture (overview)

- **5+ settler nodes** on independent machines, each running a different LLM (Claude, GPT-4, Gemini, open-source models).
- Each node runs an AXL daemon for encrypted P2P comms with peer settlers.
- When a Delphi market reaches resolution, all nodes:
  1. Fetch the resolution prompt from the market.
  2. Run inference independently against their model.
  3. Sign their answer with the AXL identity key.
  4. Exchange signed answers over AXL.
  5. Reach weighted-majority consensus.
  6. Submit the agreed settlement on-chain via the Delphi SDK.
- Anyone can verify a Synod settlement by checking that the on-chain proof was reached by a quorum of distinct, signed model identities.

## Status

In active development. Daily commits track progress.

## What is new vs reused

- **New**: all consensus protocol code, settler agent code, Synod-specific configs and tooling, demo UI.
- **Reused**: [Gensyn AXL node binary](https://github.com/gensyn-ai/axl) (open-source, Go); Gensyn Delphi SDK (TypeScript); Anthropic / OpenAI / Google Gemini SDKs.

## License

MIT — see [LICENSE](./LICENSE).

## AI usage

This project was built with assistance from Claude Code (Anthropic Opus 4.7). See [AI_USAGE.md](./AI_USAGE.md) for full attribution and the spec/prompt artifacts used to direct the AI.
