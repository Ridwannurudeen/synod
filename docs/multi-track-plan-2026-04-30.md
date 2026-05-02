# Synod — Multi-Track Plan for ETHGlobal Open Agents

Date: 2026-04-30
Deadline: **Sunday May 3, 2026 12:00 PM EDT** — ~3 days
Author: rebuilt from scratch after yesterday's chat plan was lost

This file replaces yesterday's lost plan. It covers every Open Agents prize
track, scores Synod's fit honestly, picks the ones worth chasing, and lays out
exact code-level tasks with hour estimates.

## TL;DR

Pursue **3 tracks**, drop **2**:

| Track | Pool | Decision | Rationale |
|---|---:|---|---|
| **Gensyn AXL** | $5K | ✅ pursue (primary, already in flight) | Synod's reason to exist |
| **ENS — Best Integration + Most Creative** | $5K (2 × $1,250 1st) | ✅ pursue (in flight via `synodai.eth`) | Subnames-as-role-tokens are load-bearing |
| **0G — Framework + Swarm** | $15K (2 × $7,500) | ✅ pursue (highest EV) | Synod IS a heterogeneous AI swarm. Needs 0G chain deploy + 0G storage anchor |
| **Uniswap Foundation** | $5K | ❌ skip | No natural fit; "swap/settle value onchain" ≠ oracle settlement |
| **KeeperHub** | $5K | ❌ skip (maybe builder bounty $250) | Payment-rail / framework-connector focus; not our core |

**Best-case prize math:** Gensyn 1st ($2,500) + ENS Best-Integration 1st ($1,250)
+ ENS Most-Creative 1st ($1,250) + 0G Framework 1st ($7,500) + 0G Swarm slot
($1,500) = **$14,000** plus Gensyn Foundation grant fast-track.

**Realistic floor:** Gensyn 1st + 1× ENS 1st + 0G Swarm slot = **$5,250**.

## Source-of-truth criteria per track

Pulled directly from the live prize page so we build to the rubric, not memory.

### Gensyn AXL — $5K (1st: $2,500)
- Must use AXL for inter-agent communication
- Must demonstrate cross-node communication
- Built during the hackathon only
- Judges weight: depth of AXL integration, code quality, docs, working examples,
  real utility over novelty

### ENS — $5K total
- **Best ENS Integration ($1,250 1st):** "ENS should be doing real work" via
  address resolution, metadata storage, access gating, or agent discovery.
  Functional demo, **no hard-coded values**.
- **Most Creative Use ($1,250 1st):** novel applications beyond standard name
  lookups (verifiable credentials, privacy features, access tokens). Functional
  demo, no hard-coded values.

### 0G — $15K total
- **Best Agent Framework, Tooling & Core Extensions ($7,500 1st):**
  framework-level work; hierarchical planning, reflection loops, multi-modal,
  self-evolving frameworks, modular agent libraries.
- **Best Autonomous Agents, Swarms & iNFT Innovations ($7,500, up to 5×$1,500):**
  capable autonomous agents OR multi-agent swarms/collectives.
- **Both tracks REQUIRE deployment on 0G.** GitHub + demo video <3min +
  deployment addresses + working example.

### Uniswap Foundation — $5K (skip)
- Build agents that swap/settle value onchain with execution.
- Synod has no swap surface. Forcing a UniV4 hook just to qualify would dilute.
- **Decision: skip.**

### KeeperHub — $5K (skip core, maybe bounty)
- Innovative use cases or integration bridges (x402/MPP, ElizaOS, OpenClaw,
  LangChain, CrewAI).
- Synod is settlement-layer infra, not an agent runtime that needs a connector.
- A LangChain "settle-this-prediction" tool would be 4-6h of work but produces
  a thin integration that won't beat purpose-built KeeperHub-native projects.
- **Decision: skip the prize. If time permits at the very end, capture
  $250 builder-feedback bounty by writing a real KeeperHub UX critique (1h).**

## Current state baseline

Before the plan I want this committed-and-deployed reality straight, so the
estimates are honest:

- ✅ AXL 3-node mesh, encrypted P2P (Yggdrasil)
- ✅ 3 heterogeneous settlers (Anthropic Sonnet 4.6, Anthropic Haiku 4.5,
  Google Gemini 2.5 Flash) — provider abstraction is real
- ✅ `SynodRegistry.sol` on Anvil 31337 (admin allowlist, sealed settlements)
- ✅ Confidence-weighted consensus, deterministic designated-poster
- ✅ Independent proof verifier (Python CLI + TS UI + public `/verify`)
- ✅ AXL Mesh Proof Panel at `/network`
- ✅ Live: <https://synod.gudman.xyz>
- ✅ 50 tests green (25 Python + 25 Foundry incl. fuzz)
- ✅ synodai.eth registered (Apr 29, owner `0xbEdBe31d…03CFcf`)
- 🟡 `ui/app/api/ens/route.ts` + `ui/lib/ens.ts` — **uncommitted** ENS
  resolution wiring; `network.ts` + `registry.ts` modified
- ❌ No 0G deployment, no 0G storage anchor, no contract on 0G chain
- ❌ ENS subnames `settler-{a,b,c}.synodai.eth` not yet minted
- ❌ ENS records not yet load-bearing in settler boot

## The plan

### Phase 1 — finish what's already in flight (Day 1, ~6h)

The ENS integration is half-done in the working tree. Land it first because
it's load-bearing for two prizes and the code already exists.

**1.1 Commit + ship the in-flight ENS resolver (1h)**
- Files: `ui/app/api/ens/route.ts`, `ui/lib/ens.ts`,
  `ui/lib/network.ts`, `ui/lib/registry.ts`, `ui/app/network/page.tsx`,
  `ui/app/api/verify-proof/route.ts`
- Verify the `/network` panel reads live ENS records (not hard-coded).
- Smoke: change a text record on `synodai.eth`, hit `/api/ens?refresh=1`,
  confirm `/network` reflects within one tick. **(prize criterion: "no
  hard-coded values")**

**1.2 Mint role subnames + set load-bearing records (2h)**
- Mint `settler-a.synodai.eth`, `settler-b`, `settler-c`, `registry.synodai.eth`
  via `ENSRegistry.setSubnodeRecord` from the deployer wallet.
- For each settler subname set:
  - `addr` → settler's registered EVM address
  - text `axl-pubkey` → AXL ed25519 pubkey hex
  - text `provider-model` → e.g. `anthropic:claude-sonnet-4-6`
- For `registry.synodai.eth`:
  - `addr` → `SynodRegistry` contract address
  - text `chain-id` → chain id of the active deploy
  - text `description` → "Synod settler registry"
- Persist a script `tools/ens-set-subname-records.ts` for reproducibility +
  rotation.

**1.3 Make settler boot load-bearing on ENS (2h)**
- New file: `settler/synod_settler/ens.py` — read-only ENS view (uses an Infura
  or public mainnet RPC). Resolves `settler-{label}.synodai.eth` → addr +
  texts.
- `agent.py` startup: if env `ENS_LABEL` is set, dereference
  `settler-{ENS_LABEL}.synodai.eth`, confirm:
  - `addr` matches the settler's registered EVM address (fail-fast on mismatch)
  - `axl-pubkey` matches identity key (fail-fast on mismatch)
- This is what makes ENS "doing real work": settler refuses to start if its
  ENS identity contradicts its on-chain registry entry.

**1.4 Vote-receipt as ENS contenthash (1h, Most-Creative angle)**
- After every successful settlement, post a CIDv1 of the proof bundle to a
  contenthash on a per-question subname:
  `settlement-{questionId8}.synodai.eth` → contenthash IPFS CID.
- The `/verify` page resolves contenthash, fetches the bundle from IPFS,
  re-runs the verifier, shows a green badge.
- Reuses the IPFS pinning service we already have (or `web3.storage`).
- Picks up the Most-Creative track: ENS as a cryptographic settlement-receipt
  index, not a name lookup.

**Phase 1 deliverables for ENS prize submission:**
- 4 minted subnames with live records (no hard-coded values)
- Settlers fail-closed on ENS mismatch (load-bearing)
- Proof receipts pinned and discoverable via ENS contenthash
- `/network` panel + `/verify` page both visibly read live ENS

### Phase 2 — 0G deploy + storage anchor (Day 2, ~9h)

This is the highest-EV track. The goal is **0G chain deploy of `SynodRegistry`
+ 0G Storage anchor for proof bundles**, both load-bearing in the demo.

**2.1 Add 0G chain deploy target (2h)**
- `contracts/foundry.toml`: add `[profile.zerog]` profile with the 0G testnet
  RPC + chain id (look up from 0G docs at deploy time).
- `contracts/script/Deploy.s.sol`: already chain-agnostic — confirm.
- Fund deployer wallet with 0G testnet OG.
- Deploy `SynodRegistry` to 0G; capture address.
- Persist the address in `ui/lib/registry.ts` (chain switch table) + on
  `registry.synodai.eth` text records.

**2.2 Multi-chain UI (2h)**
- `ui/lib/chains.ts` — add 0G chain config alongside Anvil/Gensyn L2.
- `/network` and `/verify` accept `?chain=zerog` to operate on the 0G deploy.
- Demo will run **Anvil for speed + 0G for prize anchoring**, with both
  visible in the UI.

**2.3 0G Storage proof anchor (3h)** — the differentiator
- New: `settler/synod_settler/zg_storage.py` — uploads the canonical
  signed-vote bundle to 0G Storage (REST API or SDK), returns the storage
  root hash.
- `agent.py` posting flow: after `recordSettlement`, upload the same proof
  bundle to 0G Storage. Capture the storage root.
- Add a 33rd byte: include the storage root hash in the on-chain
  `signedVotesPayload` (or post it via a new event `SettlementMirrored`).
- The `/verify` page shows two badges:
  - "EVM proof verified" (existing on-chain audit)
  - "0G storage proof verified" (re-fetch from 0G + recompute)
- This is the "framework-level extension" angle: Synod as an oracle
  framework with **dual anchoring** (EVM consensus + 0G persistent storage).

**2.4 Update tests + docs (1h)**
- Foundry test: deploys to local fork of 0G (or skipped if RPC unavailable).
- Python test: mocks 0G storage upload, asserts root hash flows into payload.
- README: "Deployments" section lists Anvil + 0G with their addresses.
- New doc `docs/zero-g-anchor.md` explaining the dual-anchor architecture.

**2.5 Architecture diagram + 0G submission package (1h)**
- ASCII + Excalidraw diagram showing the 0G integration.
- Architecture write-up at `docs/zero-g-architecture.md` (required by 0G prize).
- Demo video clip showing: settle → on-chain confirm → 0G storage CID resolves →
  `/verify` re-runs proof from 0G data. Same video, additional segment.

**Phase 2 deliverables for 0G prizes:**
- `SynodRegistry` deployed on 0G (deployment address documented)
- 0G Storage as the persistent proof-bundle layer (CID stored on-chain)
- `/verify` page reproduces verification from 0G storage (no trust in the
  Synod server)
- Dual-track positioning: framework (the dual-anchor pattern) AND swarm (the
  3 settler agents)

### Phase 3 — record + submit (Day 3, ~5h)

**3.1 Final demo doctor + run book (1h)**
- Update `tools/demo-doctor.sh` to verify all 4 chains/services (Anvil RPC,
  0G RPC, ENS resolver, IPFS pinning) before recording.
- One-page run book at `docs/recording-runbook.md`.

**3.2 Re-record demo (2-3 takes, allow 2h)**
- Open: state the problem (Delphi's single-AI-settler weakness)
- Show 3 AXL nodes communicating across hosts in `/network`
- Inject a question, watch consensus form
- Show settlement landing on Anvil (fast)
- Show same proof bundle resolved via 0G Storage CID
- Show `/verify` recomputing from 0G data
- Show ENS subnames resolving live in `/network`
- Show `settlement-{id}.synodai.eth` resolving to the IPFS receipt
- End: prize-track callouts (one sentence each) — Gensyn AXL, ENS×2, 0G×2

**3.3 Submission paperwork (1-2h)**
- Submit on ETHGlobal Hacker Dashboard:
  - Project name, description, video, GitHub
  - Tag prize tracks: Gensyn AXL, ENS Best Integration, ENS Most Creative,
    0G Framework, 0G Swarm
  - Per-track requirements:
    - 0G: deployment addresses + architecture diagram + working example
    - ENS: functional demo (link to /network and /verify)
    - Gensyn AXL: cross-node demonstration (already covered)
- AI_USAGE.md update: add 0G + ENS work attribution.
- README "submission" section listing the 5 tracks chased.

### Optional — KeeperHub builder feedback bounty (30-60 min)
- Read KeeperHub docs once.
- Try to integrate a single tool/skill (e.g. wrap settlement injection as a
  KeeperHub action) for ~30 min, even if it doesn't ship.
- Write a real critique in `docs/keeperhub-feedback.md`: 3 bugs/UX gaps, 2
  feature requests, 1 doc improvement. Submit for the $250 bounty.
- **Skip if Phase 1+2 run long.** Floor priority.

## Time budget

| Phase | Hours |
|---|---:|
| Phase 1 (ENS) | 6 |
| Phase 2 (0G) | 9 |
| Phase 3 (record + submit) | 5 |
| Optional KeeperHub bounty | 1 |
| **Total** | **20-21** |

3 days × 8 useful hours ≈ 24h. **Fits with a small buffer.**

## Risks & mitigations

| Risk | Probability | Mitigation |
|---|---|---|
| 0G testnet RPC instability or faucet starvation | Medium | Deploy contract early Day 2; if RPC dies, fall back to "deployed once, demo replays the tx hash" |
| 0G Storage SDK Python support poor | Medium | Use REST API directly via `httpx`; keep storage layer optional in `zg_storage.py` |
| ENS contenthash → IPFS pinning quirks | Low | Reuse existing pinning service; cache CIDs locally |
| ENS subname-mint gas + propagation slow | Low | Mint Day 1 morning, give 24h for any indexer lag |
| Demo recording over 3min | Medium | Pre-cut to 2:50 hard limit; per-track callouts at end take 8s each |
| Multi-track judges fatigued by spread | Medium | Each track gets its own 20s segment with clear sponsor name on-screen |

## Locked tradeoffs (do not relitigate)

- **Drop Uniswap track.** No natural settlement-layer fit. A forced V4 hook
  dilutes the AXL/0G pitch.
- **Drop KeeperHub primary track.** Keep the builder bounty as floor only.
- **0G deploy stays on testnet.** Mainnet only if testnet fails.
- **Demo runs Anvil for the live consensus segment** to keep latency tight;
  0G appears as the persistent anchor + receipts. Both visible.
- **ENS reads happen against mainnet** — synodai.eth is on mainnet. Settlers
  use a public mainnet RPC; this is fine, ENS is read-only at boot.
- **No new LLM providers.** Three is enough heterogeneity.

## Submission checklist

Before clicking submit on ETHGlobal:

- [ ] Demo video <3min, 720p+, real voice
- [ ] GitHub `main` clean, all commits descriptive
- [ ] AI_USAGE.md current
- [ ] README "Deployments" section lists Anvil + 0G addresses
- [ ] `synodai.eth` resolver returns live texts (test via dnslookup-style tool)
- [ ] `settler-a/b/c.synodai.eth` resolve to correct addrs + texts
- [ ] `registry.synodai.eth` text records list both chain deploys
- [ ] At least one `settlement-*.synodai.eth` contenthash resolves to an
      IPFS CID containing a valid proof bundle
- [ ] `/verify` page recomputes from 0G Storage successfully (no trust in
      Synod server)
- [ ] Deployment addresses for both Anvil + 0G captured in README
- [ ] Architecture diagram for 0G submission
- [ ] Per-track callouts in video timestamped in submission notes

## Definition of "done" per prize

| Prize | Done means |
|---|---|
| Gensyn AXL | Existing AXL Mesh Proof + cross-node demo, unchanged |
| ENS Best Integration | Settler boot fail-closed on ENS mismatch; `/network` reads live records |
| ENS Most Creative | `settlement-*.synodai.eth` contenthash → IPFS proof receipts; `/verify` reproduces from ENS-pointed data |
| 0G Framework | `SynodRegistry` deployed on 0G; framework write-up emphasizes dual-anchor pattern |
| 0G Swarm | Same deploy + 3-settler swarm visible on 0G chain via explorer |
