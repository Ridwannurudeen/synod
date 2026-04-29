# Synod Roadmap

This roadmap is grant-honest: it states what ships in the hackathon
submission, what's the next funded milestone, and why each item exists. No
hand-waving and no claims that aren't backed by code on `main`.

For the deeper write-up of how Synod scores against the Gensyn AXL prize
criteria, see [`docs/winning-roadmap-2026-04-29.md`](docs/winning-roadmap-2026-04-29.md).

## Shipped on `main` (ETHGlobal Open Agents submission)

- ✅ 3 independent settlers, one per LLM provider (Anthropic Sonnet 4.6,
  Anthropic Haiku 4.5, Google Gemini 2.5 Flash). Each runs as its own
  process with its own ed25519 identity and EVM key.
- ✅ Real AXL P2P transport: 3 AXL daemons over Yggdrasil mesh, encrypted
  inbound/outbound, no central broker. Verifiable in the live `/network`
  panel and in each daemon's `/topology` output.
- ✅ `SynodRegistry` on chain (Solidity 0.8.24, Foundry, 25 tests + 256-run
  fuzz): admin-curated allowlist, dup-pubkey rejection, payload bounds,
  per-outcome quorum upper bound, sealed-on-first-write finality.
- ✅ Confidence-weighted, per-outcome quorum off-chain consensus: the
  winner needs `threshold` distinct registered settlers voting *for that
  outcome*, not just `threshold` total votes.
- ✅ Deterministic designated-poster (lowest-pubkey-wins) so the network
  can't double-post a settlement.
- ✅ Independent proof verifier shipped twice: Python CLI
  (`tools/verify_settlement.py`) and TypeScript (`ui/lib/proof-verifier.ts`)
  driving an in-UI badge plus the public `/verify` proof explorer. Both
  parse the on-chain `signedVotesPayload`, recover ed25519 signatures,
  cross-check registry membership, and recompute weighted score + quorum.
- ✅ AXL Mesh Proof Panel (`/network`): live read of every daemon's
  `/topology`, on-chain registration cross-check, mesh-edge graph.
- ✅ Live deployment: <https://synod.gudman.xyz>, full stack via systemd
  on a single VPS, end-to-end inject → consensus → on-chain → verifier
  badge in 4 seconds.
- ✅ Deterministic test provider: smoke tests run the full AXL +
  consensus + on-chain path in CI without API keys.

## Honest gap (relevant for the grant)

Today the contract anchors the canonical signed-vote payload as raw bytes
and validates the *poster's* registration; it does not recover ed25519
signatures or recompute quorum on-chain. The off-chain verifier (CLI + UI
+ public `/verify`) catches malformed quorums and rejects them. A
malicious *registered* settler could still seal a structurally invalid
settlement on-chain, and clients have to run the verifier to know it is
bad.

For a hackathon demo this trust model is acceptable and clearly
documented. For Gensyn-grade settlement infra it isn't.

## Funded next milestone — EIP-712 dual-signed quorum

The grant-grade upgrade. Each settler keeps its ed25519 AXL identity for
mesh transport, **and** signs a typed EIP-712 vote with the EVM key it
already registered with `SynodRegistry`. `recordSettlement` then:

1. Decodes the bundle of EIP-712 signatures from `signedVotesPayload`.
2. Calls `ECDSA.recover` per signature.
3. Asserts every recovered address is in the `settlers` mapping.
4. Counts per-outcome quorum on-chain and reverts if it doesn't match
   `quorumSize` + `outcome` claimed by the poster.
5. Optionally still anchors the ed25519 audit trail in a parallel field
   for off-chain replay.

Result: the contract — not the verifier — enforces the quorum. The
on-chain settlement becomes self-contained proof.

Estimated effort: 1.5–2 dev-weeks (contract + agent + both verifiers +
tests + migration). Cleanly separated from the v1 contract by deploying
`SynodRegistryV2` next to `V1`; agents register in both during the
transition.

## Roadmap items beyond v2

- **Evidence-bound votes.** Add an `evidence_hash` field to the signed
  vote (sha256 of consulted source manifests / market-data snapshots).
  Settlers commit to *what they used to decide*, not just the final
  answer; proof explorer can show evidence links per settler.
- **Heterogeneity audit.** Periodic on-chain attestation of each settler's
  model identity (provider + model tag) so the chain — not the operator
  — proves the network is heterogeneous.
- **Slashable bonds.** Each settler stakes; provably-bad settlements
  (failed proof verifier, signed evidence mismatch) burn stake.
- **Delphi adapter.** Drop-in replacement for Delphi's single-AI-settler
  callback, gated behind market-creator opt-in. Synod proof becomes the
  market's settlement evidence.
- **Multi-network deployment.** Run on Gensyn L2 mainnet (chain id
  685689) instead of local Anvil; cost-amortize via batched settlements
  if gas is non-trivial.

## Non-goals (calling out scope clearly)

- We are not building a prediction market UI. Delphi is the market;
  Synod is the settler layer.
- We are not retraining models. Each settler runs an off-the-shelf
  inference call; the value is in the *coordination + proof* layer, not
  in beating GPT/Claude/Gemini at reasoning.
- We are not committing to fully-permissionless settler joining at v2.
  Admin allowlist is a v2 invariant; v3 explores stake-gated joining.
