# Quickstart

Five minutes from `git clone` to a running local Synod stack.

## Live demo (no install)

If you just want to poke at the protocol, the production deployment is at:

- **UI**: https://synod.gudman.xyz
- **API**: `curl https://synod.gudman.xyz/api/agent/settler-a.synodai.eth`
- **Settler ENS profiles**: `settler-{a,b,c,d}.synodai.eth` on Ethereum mainnet
- **Registry on Gensyn L2**: [`0xD387f749…b6ad`](https://gensyn-mainnet.explorer.alchemy.com/address/0xD387f749667590940d7c68CA350e57FbcE62b6ad)
- **iNFT contract on 0G Galileo**: [`0x4fF6712B…2D85`](https://chainscan-galileo.0g.ai/address/0x4fF6712B364A06f4f23878dE3c4678E8F48f2D85)

## Local stack (clone + run)

### Prerequisites

```bash
# Node 20+
node --version

# Python 3.11+
python3 --version

# Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Optional: Go 1.23+ if you need to build the AXL daemon from source
go version

# tmux (recommended — make demo runs services in named panes)
tmux -V
```

### Three commands

```bash
git clone https://github.com/Ridwannurudeen/synod.git
cd synod

make install       # ~3 min — pulls forge-std, npm deps, pip deps
make build         # ~30 sec — compile contracts + UI
make test          # ~1 min — runs all test suites
```

That should leave you with passing tests and a buildable repo.

### Run the local demo (anvil + 3 settlers + UI)

```bash
make demo          # spawns a tmux session 'synod' with all services
```

Open http://localhost:3000. The homepage will let you submit a question; settlers will deliberate over a local Yggdrasil mesh, post the consensus to the local SynodRegistry on Anvil, and surface the result.

To stop:

```bash
make stop
```

### Run only the live preflight (no local stack)

```bash
make preflight
```

Health-checks the production deployment — public surface, ENS bootloader, settler infra, cross-machine mesh, 0G Storage retrieval, judgment subname mints. Useful for verifying the live demo before recording / showing off.

## Repo layout

```
contracts/        # Foundry: SynodRegistry.sol + Foundry tests
settler/          # Python: AXL identity, consensus, on-chain client, settler agent
  synod_settler/  # main package
  tools/          # CLIs (inject_question, mint_judgment, verify_settlement)
  tests/          # pytest
ui/               # Next.js 16 + viem + Tailwind v4
  app/            # routes (/, /gallery, /network, /verify) + /api/*
  lib/            # ENS resolver, network state, registry client, site chrome
docs/             # ENSIP draft, demo theater, submission bodies, comparison
  inft-mints.json # 0G Galileo ERC-7857 mint record (4 settlers, tokenId 0-3)
scripts/          # demo_preflight.sh, ENS Tier S setup, mint helpers
```

## Where the canonical state lives

| Thing | Where |
|---|---|
| Settlement contract | Gensyn L2 mainnet, chain 685689, addr [`0xD387…b6ad`](https://gensyn-mainnet.explorer.alchemy.com/address/0xD387f749667590940d7c68CA350e57FbcE62b6ad) |
| Settler identity (4 ENS subnames) | Ethereum mainnet under `synodai.eth` |
| Deliberation transcripts | 0G Storage Galileo, retrievable at `https://indexer-storage-testnet-turbo.0g.ai/file?root=0x…` |
| Judgment subnames | Ethereum mainnet, `j-{hash}.synodai.eth` |
| iNFTs (one per settler) | 0G Galileo, contract [`0x4fF6712B…2D85`](https://chainscan-galileo.0g.ai/address/0x4fF6712B364A06f4f23878dE3c4678E8F48f2D85), tokenId 0-3 |

## Verify a real settled question (no install)

```bash
# Find a recent question
curl -s https://synod.gudman.xyz/api/gallery | jq '.items[0].questionId'

# Verify the proof
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"questionId":"<paste here>"}' \
  https://synod.gudman.xyz/api/verify-proof | jq '.status, .votes | length'
```

Or, locally:

```bash
cd settler
.venv/bin/python tools/verify_settlement.py --question-id 0x<hex>
```

Both paths produce identical results — the HTTP route in the UI uses the same `proof_verifier` library as the CLI.

## Common fixes

- **`make demo` complains about tmux**: `apt install tmux` (or brew install on macOS)
- **Foundry not on PATH after install**: `source ~/.bashrc` or open a new shell
- **Settler agents won't start**: check `.env.{a,b,c}` files exist with `SYNOD_*` env vars; copy from `.env.example` if it exists, otherwise see `settler/synod_settler/agent.py` for the required vars

## Next reads

- [`docs/ENSIP-DRAFT-AI-AGENT-IDENTITY.md`](docs/ENSIP-DRAFT-AI-AGENT-IDENTITY.md) — the proposed ENS schema for AI agents
- [`docs/COMPARISON.md`](docs/COMPARISON.md) — Synod vs Chainlink Functions / UMA / Pyth / Reality.eth / Bittensor
- [`docs/DEMO_THEATER.md`](docs/DEMO_THEATER.md) — five signature scenarios for the demo video
- [`docs/SUBMISSIONS.md`](docs/SUBMISSIONS.md) — full per-track ETHGlobal Open Agents writeup
