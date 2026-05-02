# Synod — local dev / demo orchestrator
#
# Quickstart for a fresh clone:
#
#   make install      — fetch dependencies (forge, npm, pip)
#   make build        — compile contracts + UI + axl daemon
#   make demo         — run the full local stack (anvil + 3 settlers + UI)
#   make test         — run all test suites
#   make stop         — kill anything still running
#
# Prerequisites (one-time, host install):
#   - Node 20+ (https://nodejs.org)
#   - Python 3.11+ + pip
#   - Foundry (https://getfoundry.sh) — `curl -L https://foundry.paradigm.xyz | bash && foundryup`
#   - Go 1.23+ (only for building the AXL daemon from source)
#   - tmux (recommended for `make demo` — runs services in named panes)
#
# Live mainnet deployment (canonical, not local):
#   - https://synod.gudman.xyz
#   - SynodRegistry on Gensyn L2: 0xD387f749667590940d7c68CA350e57FbcE62b6ad
#   - synodai.eth on Ethereum mainnet
#   - 4 ERC-7857 iNFTs on 0G Galileo: 0x4fF6712B364A06f4f23878dE3c4678E8F48f2D85

.PHONY: help install install-axl install-contracts install-settler install-ui \
        build build-axl build-contracts build-ui \
        test test-contracts test-settler \
        anvil bootstrap settlers ui demo \
        stop preflight clean

help:
	@echo "Synod — make targets:"
	@echo ""
	@echo "  make install    — fetch all dependencies"
	@echo "  make build      — compile contracts + UI + axl"
	@echo "  make test       — run all test suites (Foundry + pytest)"
	@echo ""
	@echo "  make demo       — start anvil + 3 settlers + UI (local stack)"
	@echo "  make stop       — kill local services"
	@echo "  make preflight  — health-check the live deployment"
	@echo ""
	@echo "  make clean      — remove build artifacts"
	@echo ""
	@echo "Live demo: https://synod.gudman.xyz"

# ------------------------------------------------------------------
# install
# ------------------------------------------------------------------

install: install-contracts install-settler install-ui
	@echo "[install] all done. AXL daemon: run 'make install-axl' if you need to build it from source"

install-axl:
	@echo "[install-axl] cloning + building gensyn-ai/axl..."
	@if [ ! -d axl-src ]; then \
	  git clone --depth 1 https://github.com/gensyn-ai/axl.git axl-src; \
	fi
	cd axl-src/cmd && go build -o ../../axl/axl-node .
	@echo "[install-axl] axl/axl-node built"

install-contracts:
	cd contracts && forge install foundry-rs/forge-std --no-commit 2>/dev/null || true

install-settler:
	cd settler && python3 -m venv .venv
	cd settler && .venv/bin/pip install -e . && .venv/bin/pip install -r requirements.txt

install-ui:
	cd ui && npm install

# ------------------------------------------------------------------
# build
# ------------------------------------------------------------------

build: build-contracts build-ui
	@echo "[build] done"

build-axl:
	cd axl-src/cmd && go build -o ../../axl/axl-node .

build-contracts:
	cd contracts && forge build

build-ui:
	cd ui && npm run build

# ------------------------------------------------------------------
# test
# ------------------------------------------------------------------

test: test-contracts test-settler
	@echo "[test] all green"

test-contracts:
	cd contracts && forge test -vv

test-settler:
	cd settler && .venv/bin/pytest -q

# ------------------------------------------------------------------
# local demo stack — anvil + 3 settlers + UI (port 3000)
# ------------------------------------------------------------------

anvil:
	@echo "[anvil] starting on :8545 (block-time 1s)..."
	anvil --block-time 1 --chain-id 31337

bootstrap:
	@bash scripts/local-bootstrap.sh

settlers:
	@echo "[settlers] use 'make demo' instead — settlers depend on anvil + AXL being up"

ui:
	cd ui && npm run dev

demo:
	@echo ""
	@echo "============================================================"
	@echo "Synod local demo"
	@echo "============================================================"
	@echo ""
	@echo "This target requires tmux. It will create a session 'synod' with:"
	@echo "  - pane 0: anvil (local EVM)"
	@echo "  - pane 1: synod-bootstrap (deploys SynodRegistry, registers 3 settlers)"
	@echo "  - pane 2: AXL daemon for settler A"
	@echo "  - pane 3: AXL daemon for settler B"
	@echo "  - pane 4: AXL daemon for settler C"
	@echo "  - pane 5: settler A agent"
	@echo "  - pane 6: settler B agent"
	@echo "  - pane 7: settler C agent"
	@echo "  - pane 8: Next.js UI on http://localhost:3000"
	@echo ""
	@echo "Run 'make stop' to tear it down."
	@echo ""
	@command -v tmux >/dev/null || (echo "ERROR: tmux not installed"; exit 1)
	@bash scripts/demo-up.sh

stop:
	@if tmux has-session -t synod 2>/dev/null; then \
	  tmux kill-session -t synod && echo "[stop] tmux session killed"; \
	else \
	  echo "[stop] no tmux session 'synod' running"; \
	fi
	@pkill -f "axl-node -config node-" 2>/dev/null && echo "[stop] axl daemons killed" || true
	@pkill -f "anvil --block-time" 2>/dev/null && echo "[stop] anvil killed" || true

# ------------------------------------------------------------------
# preflight — health-check the live deployment (no local stack)
# ------------------------------------------------------------------

preflight:
	@bash scripts/demo_preflight.sh

# ------------------------------------------------------------------
# clean
# ------------------------------------------------------------------

clean:
	rm -rf contracts/out contracts/cache
	rm -rf ui/.next ui/node_modules/.cache
	rm -rf settler/.venv settler/build settler/synod_settler.egg-info
	@echo "[clean] build artifacts removed"
