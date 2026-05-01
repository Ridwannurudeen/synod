# Feedback — ENS

Honest engineering feedback from building Synod's ENS integration during ETHGlobal Open Agents 2026. We registered `synodai.eth` on mainnet via the v3 controller, set load-bearing text records on the parent, minted role subnames for 4 settlers, and minted 2 transferable judgment subnames so far. All flows live and verifiable.

## What worked exceptionally

- **The v3 ETHRegistrarController** (`0x253553366Da8546fC250F225fe3d25d0C782303b`) is delightful. One commit + 60s wait + one register tx, and the name is auto-wrapped in NameWrapper with PublicResolver pre-set. Total cost on Apr 29 2026: 0.0024 ETH (~$8).
- **NameWrapper.setSubnodeRecord** for minting subnames is clean — one tx per subname and you can assign owner / fuses / expiry inline.
- **PublicResolver.multicall** lets us batch `setAddr + setText × 7` into a single tx, which is the difference between "subnames feel viable" and "subnames cost too much to be primary identity."
- **ENS app rendering of arbitrary text records** is a quiet superpower. Once we set `synod.role`, `synod.pubkey`, `synod.parent`, etc., they showed up immediately in the ENS app UI alongside standard records. Free UX.

## Friction we hit

### 1. Gas estimation for `multicall` is non-obvious

We sized the multicall gas at 450k for a setAddr + 7 setText calls, expecting ~50k gas per call. The actual cost was 600-700k+ depending on the byte length of the longest text record (a `synod.question` with a 200-char prompt + a `description` with 80 chars pushed past 700k).

This caused our judgment subname mint flow to fail twice (subnode minted, records-set tx ran out of gas) before we figured it out. SSTORE costs scale with bytes-stored, more aggressively than typical gas heuristics.

**Suggestion**: PublicResolver docs could include a "typical gas per setText" table by string length. We landed on 900k gas as a safe default for 8-record multicalls with mid-length strings.

### 2. v3 controller name wrapping is auto, but docs don't lead with it

We initially queried `ENS Registry.owner(namehash)` and saw the address was `NameWrapper`, which made us think we'd done something wrong. The v3 controller wraps automatically — that's correct behavior — but the registration docs don't open with that fact.

### 3. NameWrapper subname creation needs `PARENT_CANNOT_CONTROL` clarity

Our parent (synodai.eth) had fuses 196608 (`PARENT_CANNOT_CONTROL | IS_DOT_ETH`), set automatically by the v3 controller. To create subnames with their own fuses, the parent would need `CANNOT_UNWRAP` first. We minted with fuses=0 because we don't need to burn fuses on subnames yet — but the docs around fuse interactions for parent-vs-subname mint flows took us multiple reads to internalize.

### 4. Etherscan / ENS app text-record propagation lag

Newly-set text records sometimes took 1–3 minutes to appear in the ENS app UI even after the tx confirmed. Not a bug — just a UI-cache / subgraph-indexer lag — but during a hackathon this was confusing the first time.

## Things we loved seeing in your direction

The [ens.domains/blog/post/ens-ai-agent-erc8004](https://ens.domains/blog/post/ens-ai-agent-erc8004) blog post explicitly endorsing subname-per-agent + text records + ERC-8004 reputation is exactly the pattern we converged on independently. We've drafted an ENSIP at `docs/ENSIP-DRAFT-AI-AGENT-IDENTITY.md` formalizing the schema we used for `synodai.eth` — feedback welcome.

## Schema we used (in case useful for ENSIP discussion)

**Parent (`synodai.eth`)**:
- `synod.registry`, `synod.chain-id`, `synod.rpc`, `synod.threshold` — runtime config (UI cold-boots from these)
- `url`, `description`, `com.github` — standard

**Settler subnames (`settler-{a,b,c,d}.synodai.eth`)**:
- `addr` — settler's EVM address
- `synod.role` — model identity (e.g. `anthropic-claude-sonnet-4-6`)
- `synod.pubkey` — ed25519 mesh pubkey
- `synod.parent` — backpointer

**Judgment subnames (`j-{shortHash}.synodai.eth`)**:
- `addr` — owner (question submitter, transferable)
- `synod.outcome`, `synod.quorum`, `synod.weighted-score`
- `synod.transcript-cid` — 0G Storage merkle root
- `synod.tx` — Gensyn L2 settlement tx hash
- `synod.question`, `description`

## Live: https://synodai.eth

Live deployment, all 4 settler subnames + 2 judgment subnames mintable on demand. Genuinely great infrastructure to build on — these are minor pain points, not blockers.
