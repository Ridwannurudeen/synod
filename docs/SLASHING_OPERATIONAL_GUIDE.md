# Slashing — Operational Guide

The on-chain slashing pieces are already in `SynodRegistry` at
`0xD387f749667590940d7c68CA350e57FbcE62b6ad` on Gensyn L2 mainnet. This
guide is the operator playbook for turning those pieces on and producing a
recorded slashing event for the demo video.

## 1. The 6-tx demo flow

| # | Caller | Action | Function |
|---|--------|--------|----------|
| 1 | admin | configure security parameters | `configureSecurity(window, minSettlerBond, minChallengeBond)` |
| 2 | each settler | top up bond if below `minSettlerBond` | `depositBond()` (msg.sender-only) |
| 3 | admin | re-read settler bonds to confirm all settlers are eligible | (read) `settlers(addr)` |
| 4 | challenger | open a challenge during the live window | `challengeSettlement(qid, evidenceHash, reason)` payable |
| 5 | admin | resolve the challenge as sustained | `resolveChallenge(qid, true, challenger)` |
| 6 | admin | confirm slash | (read) `totalSlashedBond()` |

Every write tx surfaces at `https://gensyn-mainnet.explorer.alchemy.com/tx/{hash}`.

## 2. Configure security (one-shot)

```
python settler/tools/configure_security.py --dry-run
python settler/tools/configure_security.py \
    --window 86400 \
    --min-settler-bond 1000000000000000 \
    --min-challenge-bond 100000000000000
```

Defaults: 86400 s (24 h), 0.001 ETH settler bond, 0.0001 ETH challenge bond.
The script reads the deployer key from `/opt/synod-app/runtime/.deployer-mainnet.json`
(shape: `{"private_key": "0x..."}`). Idempotent — exits 0 with no tx if the
on-chain values already match.

Until this runs, every settlement has `challengeDeadline == block.timestamp`,
so the optimistic security layer is a no-op.

## 3. Top up settler bonds

`depositBond()` is `msg.sender`-only by design — only the settler EOA can
fund its own bond. The runner script accepts a comma-separated list of
settler key files (same shape as the deployer key) and tops up any settler
below `minSettlerBond` from that settler's own EOA.

## 4. Run the slashing demo

```
python settler/tools/run_slashing_demo.py --dry-run \
    --question-id 0x<recently-settled-qid>

python settler/tools/run_slashing_demo.py \
    --question-id 0x<recently-settled-qid> \
    --settler-key-paths /opt/synod-app/runtime/.settler-1.json,/opt/synod-app/runtime/.settler-2.json,…
```

The runner aborts if the chosen `question_id` is outside its challenge
window or already finalized. Pick a settlement that posted in the last 24
hours (or whatever window is configured). The /verify page lists recent
settlements by question id.

## 5. Admin key custody

The deployer EOA is a single externally-owned account. It is the registry
admin (`configureSecurity`, `resolveChallenge`, `registerSettler`,
`revokeSettler`) **and** the most natural challenger account during the
demo. This is a single point of trust — sustained challenges and the
slashed-bond redistribution depend on the deployer remaining honest. A
production deployment would migrate `admin` to a multisig or a governance
contract via `transferAdmin(newAdmin)`. That migration is out of scope
for this hackathon submission.

## 6. On-camera capture

During recording, capture these tabs in order:

- **Tab A** — `https://gensyn-mainnet.explorer.alchemy.com/address/0xD387f749667590940d7c68CA350e57FbcE62b6ad`
  filtered to "configureSecurity". The most recent tx shows the live security
  parameters. Pause here while explaining the bond economics.
- **Tab B** — the `SettlementChallenged` log on the challenge tx. Show the
  `evidenceHash`, `challenger`, and `reason` fields decoded.
- **Tab C** — the `ChallengeResolved` log on the resolve tx. Show
  `sustained=true`, `recipient`, `payout = challengeBond + slashAmount`.
- **Tab D** — `/verify?qid=<qid>` showing the settlement is now `voided`
  and the question is reopen-able. The "Challenge this settlement" CTA is
  no longer rendered (the window is closed for that qid).

The event log on each tx is also reachable directly in the browser via
the explorer's Logs tab — pin those URLs into the recording script.
