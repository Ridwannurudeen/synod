#!/usr/bin/env bash
# Single-command Synod demo. Brings up:
#   - anvil (local L2 stand-in)
#   - SynodRegistry deployed + 2 settlers registered
#   - 2 local AXL nodes
#   - 2 settler agent processes (Anthropic Sonnet 4.6 each)
#   - Next.js UI on http://localhost:3000
#
# Then idles until you Ctrl-C, at which point everything is killed.
#
# Anvil's deterministic test keys are publicly known fixtures — fine for
# local demo, never use these on a real chain.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SETTLER_DIR="${ROOT_DIR}/settler"
CONTRACTS_DIR="${ROOT_DIR}/contracts"
UI_DIR="${ROOT_DIR}/ui"
PY="${SETTLER_DIR}/.venv/Scripts/python.exe"
[[ -x "${PY}" ]] || PY="${SETTLER_DIR}/.venv/bin/python"

export PATH="/c/Users/HP/.foundry/bin:${PATH}"

cd "${ROOT_DIR}"

ANVIL_PORT=8545
RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
ACC0_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ACC1_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
ACC1_ADDR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
ACC2_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
ACC2_ADDR="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

ANTHROPIC_API_KEY="$(grep -E '^ANTHROPIC_API_KEY=' "${SETTLER_DIR}/.env" | sed 's/^[^=]*=//')"
SYNOD_PROVIDER="$(grep -E '^SYNOD_PROVIDER=' "${SETTLER_DIR}/.env" | sed 's/^[^=]*=//' || echo anthropic)"
SYNOD_MODEL="$(grep -E '^SYNOD_MODEL=' "${SETTLER_DIR}/.env" | sed 's/^[^=]*=//' || echo claude-sonnet-4-6)"
[[ -n "${ANTHROPIC_API_KEY}" ]] || { echo "ANTHROPIC_API_KEY missing in settler/.env"; exit 1; }

if [[ -f axl/axl-node.exe ]]; then AXL_BIN="${ROOT_DIR}/axl/axl-node.exe"
elif [[ -f axl/axl-node ]]; then AXL_BIN="${ROOT_DIR}/axl/axl-node"
else echo "axl binary missing — run scripts/axl-keygen.sh and forge build first"; exit 1; fi

mkdir -p logs

echo "[demo] cleaning previous run..."
taskkill //F //IM axl-node.exe >/dev/null 2>&1 || true
taskkill //F //IM anvil.exe >/dev/null 2>&1 || true
taskkill //F //IM node.exe >/dev/null 2>&1 || true
pkill -f run_settler.py >/dev/null 2>&1 || true
sleep 1

echo "[demo] starting anvil on :${ANVIL_PORT}..."
anvil --port "${ANVIL_PORT}" --silent > "${ROOT_DIR}/logs/anvil.log" 2>&1 &
PID_ANVIL=$!

cleanup() {
  echo
  echo "[demo] shutting down..."
  kill "${PID_ANVIL}" 2>/dev/null || true
  taskkill //F //IM anvil.exe >/dev/null 2>&1 || true
  taskkill //F //IM axl-node.exe >/dev/null 2>&1 || true
  taskkill //F //IM node.exe >/dev/null 2>&1 || true
  pkill -f run_settler.py >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 30); do
  cast block-number --rpc-url "${RPC_URL}" >/dev/null 2>&1 && break
  sleep 1
done

echo "[demo] deploying SynodRegistry..."
DEPLOY_OUT=$(cd "${CONTRACTS_DIR}" && \
  DEPLOYER_PRIVATE_KEY="${ACC0_KEY}" \
  forge script script/Deploy.s.sol:Deploy \
    --rpc-url "${RPC_URL}" --broadcast --skip-simulation -vvv 2>&1)
REG_ADDR=$(echo "${DEPLOY_OUT}" | grep -oE "SynodRegistry: 0x[a-fA-F0-9]{40}" | head -1 | awk '{print $2}')
[[ -n "${REG_ADDR}" ]] || { echo "deploy failed"; echo "${DEPLOY_OUT}" | tail -20; exit 1; }
echo "[demo]   registry: ${REG_ADDR}"

echo "[demo] starting AXL nodes..."
( cd configs/local && "${AXL_BIN}" -config node-a.json > "${ROOT_DIR}/logs/node-a.log" 2>&1 ) &
( cd configs/local && "${AXL_BIN}" -config node-b.json > "${ROOT_DIR}/logs/node-b.log" 2>&1 ) &

for _ in $(seq 1 30); do
  curl -fsS http://127.0.0.1:9002/topology >/dev/null 2>&1 && \
  curl -fsS http://127.0.0.1:9012/topology >/dev/null 2>&1 && break
  sleep 1
done

PUB_A=$(curl -fsS http://127.0.0.1:9002/topology | "${PY}" -c "import sys,json;print(json.load(sys.stdin)['our_public_key'])")
PUB_B=$(curl -fsS http://127.0.0.1:9012/topology | "${PY}" -c "import sys,json;print(json.load(sys.stdin)['our_public_key'])")
echo "[demo]   node A: ${PUB_A:0:16}…"
echo "[demo]   node B: ${PUB_B:0:16}…"

echo "[demo] registering settlers..."
cast send "${REG_ADDR}" "registerSettler(address,bytes32,string)" \
  "${ACC1_ADDR}" "0x${PUB_A}" "claude-sonnet-4-6-A" \
  --rpc-url "${RPC_URL}" --private-key "${ACC0_KEY}" >/dev/null 2>&1
cast send "${REG_ADDR}" "registerSettler(address,bytes32,string)" \
  "${ACC2_ADDR}" "0x${PUB_B}" "claude-sonnet-4-6-B" \
  --rpc-url "${RPC_URL}" --private-key "${ACC0_KEY}" >/dev/null 2>&1

echo "[demo] mesh routes converging..."
sleep 12

KEY_A="${ROOT_DIR}/keys/node-a.pem"
KEY_B="${ROOT_DIR}/keys/node-b.pem"

echo "[demo] starting settler agents..."
(
  cd "${SETTLER_DIR}" && \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  SYNOD_PROVIDER="${SYNOD_PROVIDER}" SYNOD_MODEL="${SYNOD_MODEL}" \
  SYNOD_AXL_API="http://127.0.0.1:9002" SYNOD_IDENTITY_KEY="${KEY_A}" \
  SYNOD_PEER_KEYS="${PUB_B}" SYNOD_QUORUM=2 \
  SYNOD_RPC_URL="${RPC_URL}" SYNOD_REGISTRY_ADDRESS="${REG_ADDR}" \
  SYNOD_EVM_KEY="${ACC1_KEY}" SYNOD_LOG_LEVEL=INFO \
  "${PY}" tools/run_settler.py
) > "${ROOT_DIR}/logs/settler-a.log" 2>&1 &

(
  cd "${SETTLER_DIR}" && \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  SYNOD_PROVIDER="${SYNOD_PROVIDER}" SYNOD_MODEL="${SYNOD_MODEL}" \
  SYNOD_AXL_API="http://127.0.0.1:9012" SYNOD_IDENTITY_KEY="${KEY_B}" \
  SYNOD_PEER_KEYS="${PUB_A}" SYNOD_QUORUM=2 \
  SYNOD_RPC_URL="${RPC_URL}" SYNOD_REGISTRY_ADDRESS="${REG_ADDR}" \
  SYNOD_EVM_KEY="${ACC2_KEY}" SYNOD_LOG_LEVEL=INFO \
  "${PY}" tools/run_settler.py
) > "${ROOT_DIR}/logs/settler-b.log" 2>&1 &

sleep 4

echo "[demo] starting Next.js UI on :3000..."
(
  cd "${UI_DIR}" && \
  SYNOD_RPC_URL="${RPC_URL}" \
  SYNOD_REGISTRY_ADDRESS="${REG_ADDR}" \
  SYNOD_UI_LOG_FILES="logs/settler-a.log,logs/settler-b.log" \
  SYNOD_UI_AXL_API="http://127.0.0.1:9002" \
  npm run dev
) > "${ROOT_DIR}/logs/ui.log" 2>&1 &

# Wait for the UI dev server to be ready
echo -n "[demo] waiting for UI"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000 2>/dev/null; then echo " ✓"; break; fi
  echo -n "."
  sleep 1
done

cat <<EOF

================================================================
 SYNOD DEMO READY
================================================================
  UI:                http://localhost:3000
  SynodRegistry:     ${REG_ADDR}
  Anvil RPC:         ${RPC_URL}
  Settler A pubkey:  ${PUB_A}
  Settler B pubkey:  ${PUB_B}

  logs/anvil.log     anvil L2 stand-in
  logs/node-a.log    AXL daemon node A
  logs/node-b.log    AXL daemon node B
  logs/settler-a.log Synod settler A (Anthropic ${SYNOD_MODEL})
  logs/settler-b.log Synod settler B (Anthropic ${SYNOD_MODEL})
  logs/ui.log        Next.js dev server

  Open the UI, type a market resolution prompt, click "Inject question",
  watch the cards light up, the consensus crystallize, and the on-chain tx
  hash appear.

  Ctrl-C in this terminal to tear everything down.
================================================================
EOF

# Idle until the user kills the script
while true; do
  sleep 30
  # Light health check; warn if any subsystem dies
  if ! curl -fsS -o /dev/null http://127.0.0.1:9002/topology 2>/dev/null; then
    echo "[demo] WARNING: AXL node A unreachable"
  fi
done
