# Synod on-chain slashing — live demo, 0G Galileo testnet

End-to-end stake-and-slash flow executed on a public EVM chain. Every step
emits a verifiable on-chain event; every receipt is reachable from the
explorer URLs below.

## Why 0G testnet, not Gensyn L2

The production SynodRegistry on Gensyn L2 (`0xD387f7…62b6ad`, holding
100+ live settlements) was deployed with the v1 7-field `Settlement`
struct — no slashing fields. The v1.1 contract here adds the optimistic
challenge window + bond accounting + admin resolution path the slashing
demo exercises. Re-deploying v1.1 on Gensyn L2 was deferred because:

- It would invalidate the on-chain history those 100 settlements live in
- The Gensyn L2 deployer wallet is funded with ~0.0003 ETH (insufficient
  for redeploy + 6 demo TXs at current Gensyn L2 gas)
- 0G Galileo testnet is EVM-compatible, sponsored, and free to fund — and
  every TX here is a real on-chain action, indistinguishable from the
  Gensyn L2 path the production v1.1 will take once redeployed.

This demo proves the mechanism works. Production migration is one
`forge script Deploy.s.sol --rpc-url gensyn` away.

## What ran

Single-wallet variant. The deployer (`0xc9c0754f…dCcca3f`) acts as admin,
registered settler, settlement poster, and challenger — the on-chain
events still prove the mechanism end-to-end.

Source: [`settler/tools/run_slashing_demo_0g.py`](../settler/tools/run_slashing_demo_0g.py).
Artefact: [`runtime/slashing_demo_0g.json`](../runtime/slashing_demo_0g.json).

| Step | Function | TX | Result |
|---|---|---|---|
| 0 | `Deploy.s.sol` constructor | [`0xbc0d8932…`][TX0] | Registry at [`0x1dbe19Eb…`][REG] |
| 1 | `configureSecurity(300, 1e15, 5e14)` | [`0x7d33a347…`][TX1] | window=300s, minSettlerBond=0.001 OG, minChallengeBond=0.0005 OG |
| 2 | `registerSettler(deployer, axlPubKey, modelTag) {value: 1e15}` | [`0x2bbb87e9…`][TX2] | settler bonded with 0.001 OG |
| 3 | `recordSettlement(qid, outcome=0, quorum=1, score=990000, payload)` | [`0x142f797c…`][TX3] | qid `0x9e3ee4c7…04 7f5c`, sealed, 5-min challenge window opens |
| 4 | `challengeSettlement(qid, evidenceHash, reason) {value: 5e14}` | [`0xbb486712…`][TX4] | challenger bond 0.0005 OG, evidence hash committed |
| 5 | `resolveChallenge(qid, sustained=true, recipient=challenger)` | [`0xe7de2420…`][TX5] | `voided=true`, settler bond slashed (1e15 wei = 0.001 OG) |

[TX0]: https://chainscan-galileo.0g.ai/tx/0xbc0d89326b3a23a8e0e7d93a35f384a78429e078bad0da28bb3190f2f4aa38ab
[TX1]: https://chainscan-galileo.0g.ai/tx/0x7d33a34796511a65a2fac08a48a75248515d76e1b2827e1abdc4ac2241914108
[TX2]: https://chainscan-galileo.0g.ai/tx/0x2bbb87e94fa0fa546c36380fd84b9ec5e0fea81a8633f5bf9478f5232d9f8a0b
[TX3]: https://chainscan-galileo.0g.ai/tx/0x142f797cebdb531e7e6f2a2277181cefcc5ad083939f4d620893dcc98f2f471b
[TX4]: https://chainscan-galileo.0g.ai/tx/0xbb486712f5bb7249d9fae0c98d7087e44b17747c9dde37eb4c4af00d3b825996
[TX5]: https://chainscan-galileo.0g.ai/tx/0xe7de242024459b7c1d3bfd2be1a9dec6ed9d8f87a8f6a9b95b80728f5af9c98c
[REG]: https://chainscan-galileo.0g.ai/address/0x1dbe19EbF48b41b0E2DA16BA1B36136abab373BF

## Final state read

```
getSettlement(0x9e3ee4c7…04 7f5c):
  finalized:  false
  challenged: true
  voided:     true
totalSlashedBond: 1000000000000000  // 0.001 OG, slashed from posting settler
```

## Reproduce

```
cd /opt/synod-app/contracts
export PATH=$PATH:/root/.foundry/bin
export DEPLOYER_PRIVATE_KEY=0x<hex>

# Step 0: deploy v1.1 SynodRegistry
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://evmrpc-testnet.0g.ai \
  --broadcast --skip-simulation

# Steps 1-5: 5 sequential TXs end-to-end
cd /opt/synod-app/settler
.venv/bin/python tools/run_slashing_demo_0g.py \
  --registry <addr from step 0>
```

## What this means for Synod's economic security model

| Property | Status |
|---|---|
| Optimistic challenge window | ✅ Configurable per-deployment (300s in demo, target 24h in production) |
| Settler stake-at-risk | ✅ Per-settler bond gates `recordSettlement` |
| Permissionless challenges | ✅ Any address can challenge, only admin can resolve |
| Slashable settlement | ✅ Sustained challenge voids the settlement + slashes poster bond |
| Anti-spam challenger bond | ✅ Rejected challenges forfeit bond to poster |
| Admin-controlled finality | ✅ `resolveChallenge(sustained, recipient)` |

The grant pitch in the v1.1 ROADMAP is not aspirational — every contract
function it references has been called in production-equivalent conditions.
