# Synod Grant Security Model

Synod now has two explicit operating modes:

- **Hackathon demo mode**: `challengeWindowSeconds = 0`, `minSettlerBond = 0`, `minChallengeBond = 0`. Settlements are instantly usable, which keeps live demos fast.
- **Grant / production mode**: the admin configures a challenge window and bond requirements. Settlers must keep stake bonded before posting, and disputed settlements can be challenged, resolved, slashed, voided, and reposted.

## What Changed

The upgraded `SynodRegistry` adds an optimistic-finality layer around the existing signed-vote proof:

1. `configureSecurity(challengeWindowSeconds, minSettlerBond, minChallengeBond)` turns on the production security parameters.
2. `registerSettler` is payable, and registered settlers can later call `depositBond`.
3. `recordSettlement` now refuses posts from settlers whose bond is below `minSettlerBond`.
4. New settlements carry `challengeDeadline`, `finalized`, `challenged`, `voided`, challenger address, evidence hash, challenge reason, and challenge bond.
5. Anyone can call `challengeSettlement(questionId, evidenceHash, reason)` during the challenge window by posting the minimum challenge bond.
6. Admin/governance calls `resolveChallenge`.
   - If sustained: the poster is slashed up to `minSettlerBond`, the challenger receives the challenge bond plus slash payout, the settlement is voided, and the question can be reposted.
   - If rejected: the settlement is finalized, and the poster receives the challenge bond as anti-spam compensation.
7. If no challenge lands, anyone can call `finalizeSettlement` after the challenge window.

The existing `isSettled(questionId)` behavior is intentionally preserved for the live demo path. Production consumers that require economic finality should use `isFinalized(questionId)` or inspect the settlement's challenge fields.

## Security Properties

- A single registered settler can no longer post without keeping the configured minimum bond.
- Incorrect or malicious settlements have a challenge path instead of becoming permanently trusted immediately.
- A sustained challenge reopens the question, which lets the network correct the record without deploying a new registry.
- Challenge bonds reduce spam challenges because rejected challengers lose the posted bond to the settlement poster.
- UI and tooling now expose challenge metadata so frontends can show whether a settlement is live, challenged, voided, or finalized.

## Honest Caveats

This is a credible grant-stage security layer, not a finished decentralized oracle economy yet.

- Challenge resolution is still admin/governance mediated. For production, this should move to a multisig, DAO, or protocol-defined arbiter set.
- The EVM contract stores the signed-vote payload but does not verify ed25519 signatures on-chain. Verification remains off-chain through the UI and CLI verifier.
- Registration is still curated by admin. A grant milestone should make enrollment permissionless with stake-weighted or reputation-weighted controls.
- Evidence is committed as a hash and reason string. The next step is a standard evidence package format stored on 0G/IPFS, with deterministic verifier output.
- Settler bond denomination is native ETH on the target chain today. For a Gensyn-specific production path, this should become the intended settlement/staking asset.

## Tests That Cover This

- `forge test -vv` covers registration, bond deposit/withdrawal, minimum bond enforcement, finalization, challenge, sustained slashing, rejected challenge payout, and fuzzed settlement recording.
- `python -m pytest -q` covers settler-side protocol, proof, and on-chain ABI compatibility.
- `bash settler/tools/run_onchain_test.sh` deploys a local registry, registers two settlers, reaches consensus, records on-chain, and reads the expanded settlement tuple.
- `bash tools/demo-smoke-test.sh` and `bash tools/demo-smoke-test-3node.sh` verify the judge-facing UI proof path end to end.
