#!/usr/bin/env bash
# Full end-to-end integration test: 2 settlers reach consensus AND post the
# result to a real SynodRegistry contract on a local anvil chain.
#
# Anvil's default accounts are publicly known fixtures (deterministic across
# runs); using them here is safe for local testing only.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SETTLER_DIR="${ROOT_DIR}/settler"
CONTRACTS_DIR="${ROOT_DIR}/contracts"
PY="${SETTLER_DIR}/.venv/Scripts/python.exe"
[[ -x "${PY}" ]] || PY="${SETTLER_DIR}/.venv/bin/python"

export PATH="/c/Users/HP/.foundry/bin:${PATH}"

cd "${ROOT_DIR}"

# Anvil deterministic test fixtures. ALL TEST KEYS, NEVER FUND IN PRODUCTION.
ANVIL_PORT=8545
RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
ACC0_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ACC0_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cfFFb92266"
ACC1_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
ACC1_ADDR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
ACC2_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
ACC2_ADDR="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

ANTHROPIC_API_KEY="$(grep -E '^ANTHROPIC_API_KEY=' "${SETTLER_DIR}/.env" | sed 's/^[^=]*=//')"
SYNOD_PROVIDER="$(grep -E '^SYNOD_PROVIDER=' "${SETTLER_DIR}/.env" | sed 's/^[^=]*=//' || echo anthropic)"
SYNOD_MODEL="$(grep -E '^SYNOD_MODEL=' "${SETTLER_DIR}/.env" | sed 's/^[^=]*=//' || echo claude-sonnet-4-6)"
[[ -n "${ANTHROPIC_API_KEY}" ]] || { echo "ANTHROPIC_API_KEY not set in settler/.env"; exit 1; }

if [[ -f axl/axl-node.exe ]]; then AXL_BIN="${ROOT_DIR}/axl/axl-node.exe"
elif [[ -f axl/axl-node ]]; then AXL_BIN="${ROOT_DIR}/axl/axl-node"
else echo "axl binary missing"; exit 1; fi

mkdir -p logs
taskkill //F //IM axl-node.exe >/dev/null 2>&1 || true
taskkill //F //IM anvil.exe >/dev/null 2>&1 || true
pkill -f run_settler.py >/dev/null 2>&1 || true
sleep 1

echo "[1/8] starting anvil on :${ANVIL_PORT}..."
anvil --port "${ANVIL_PORT}" --silent > "${ROOT_DIR}/logs/anvil.log" 2>&1 &
PID_ANVIL=$!

cleanup() {
  echo "cleaning up..."
  kill "${PID_ANVIL}" 2>/dev/null || true
  taskkill //F //IM anvil.exe >/dev/null 2>&1 || true
  taskkill //F //IM axl-node.exe >/dev/null 2>&1 || true
  pkill -f run_settler.py >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Wait for anvil RPC
for _ in $(seq 1 30); do
  if cast block-number --rpc-url "${RPC_URL}" >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "[2/8] deploying SynodRegistry to anvil..."
DEPLOY_OUT=$(cd "${CONTRACTS_DIR}" && \
  DEPLOYER_PRIVATE_KEY="${ACC0_KEY}" \
  forge script script/Deploy.s.sol:Deploy \
    --rpc-url "${RPC_URL}" \
    --broadcast \
    --skip-simulation \
    -vvv 2>&1)
REG_ADDR=$(echo "${DEPLOY_OUT}" | grep -oE "SynodRegistry: 0x[a-fA-F0-9]{40}" | head -1 | awk '{print $2}')
if [[ -z "${REG_ADDR}" ]]; then
  echo "ERROR: failed to deploy SynodRegistry" >&2
  echo "${DEPLOY_OUT}" | tail -30 >&2
  exit 1
fi
echo "[2/8] SynodRegistry deployed at ${REG_ADDR}"

echo "[3/8] starting AXL nodes..."
( cd configs/local && "${AXL_BIN}" -config node-a.json > "${ROOT_DIR}/logs/node-a.log" 2>&1 ) &
PID_AXL_A=$!
( cd configs/local && "${AXL_BIN}" -config node-b.json > "${ROOT_DIR}/logs/node-b.log" 2>&1 ) &
PID_AXL_B=$!

for url in "${RPC_URL}" http://127.0.0.1:9002 http://127.0.0.1:9012; do :; done
for _ in $(seq 1 30); do
  curl -fsS http://127.0.0.1:9002/topology >/dev/null 2>&1 && \
  curl -fsS http://127.0.0.1:9012/topology >/dev/null 2>&1 && break
  sleep 1
done

PUB_A=$(curl -fsS http://127.0.0.1:9002/topology | "${PY}" -c "import sys,json;print(json.load(sys.stdin)['our_public_key'])")
PUB_B=$(curl -fsS http://127.0.0.1:9012/topology | "${PY}" -c "import sys,json;print(json.load(sys.stdin)['our_public_key'])")
echo "[3/8] node A pubkey: ${PUB_A}"
echo "[3/8] node B pubkey: ${PUB_B}"

# AXL keys are 32-byte hex (no 0x prefix); cast wants 0x prefix for bytes32.
PUB_A_ARG="0x${PUB_A}"
PUB_B_ARG="0x${PUB_B}"

echo "[4/8] registering settlers in SynodRegistry..."
cast send "${REG_ADDR}" \
  "registerSettler(address,bytes32,string)" \
  "${ACC1_ADDR}" "${PUB_A_ARG}" "claude-sonnet-4-6-A" \
  --rpc-url "${RPC_URL}" --private-key "${ACC0_KEY}" >/dev/null 2>&1 || \
  { echo "ERROR: registerSettler A failed" >&2; exit 1; }

cast send "${REG_ADDR}" \
  "registerSettler(address,bytes32,string)" \
  "${ACC2_ADDR}" "${PUB_B_ARG}" "claude-sonnet-4-6-B" \
  --rpc-url "${RPC_URL}" --private-key "${ACC0_KEY}" >/dev/null 2>&1 || \
  { echo "ERROR: registerSettler B failed" >&2; exit 1; }

REG_COUNT=$(cast call "${REG_ADDR}" "registeredSettlerCount()(uint256)" --rpc-url "${RPC_URL}")
echo "[4/8] registeredSettlerCount: ${REG_COUNT}"

echo "[5/8] waiting for AXL mesh routes..."
sleep 12

KEY_A="${ROOT_DIR}/keys/node-a.pem"
KEY_B="${ROOT_DIR}/keys/node-b.pem"

echo "[6/8] starting settler A (EVM=${ACC1_ADDR}, AXL=${PUB_A:0:16}..)..."
(
  cd "${SETTLER_DIR}" && \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  SYNOD_PROVIDER="${SYNOD_PROVIDER}" \
  SYNOD_MODEL="${SYNOD_MODEL}" \
  SYNOD_AXL_API="http://127.0.0.1:9002" \
  SYNOD_IDENTITY_KEY="${KEY_A}" \
  SYNOD_PEER_KEYS="${PUB_B}" \
  SYNOD_QUORUM=2 \
  SYNOD_RPC_URL="${RPC_URL}" \
  SYNOD_REGISTRY_ADDRESS="${REG_ADDR}" \
  SYNOD_EVM_KEY="${ACC1_KEY}" \
  SYNOD_LOG_LEVEL=INFO \
  "${PY}" tools/run_settler.py
) > "${ROOT_DIR}/logs/settler-a.log" 2>&1 &
PID_SET_A=$!

echo "[6/8] starting settler B (EVM=${ACC2_ADDR}, AXL=${PUB_B:0:16}..)..."
(
  cd "${SETTLER_DIR}" && \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  SYNOD_PROVIDER="${SYNOD_PROVIDER}" \
  SYNOD_MODEL="${SYNOD_MODEL}" \
  SYNOD_AXL_API="http://127.0.0.1:9012" \
  SYNOD_IDENTITY_KEY="${KEY_B}" \
  SYNOD_PEER_KEYS="${PUB_A}" \
  SYNOD_QUORUM=2 \
  SYNOD_RPC_URL="${RPC_URL}" \
  SYNOD_REGISTRY_ADDRESS="${REG_ADDR}" \
  SYNOD_EVM_KEY="${ACC2_KEY}" \
  SYNOD_LOG_LEVEL=INFO \
  "${PY}" tools/run_settler.py
) > "${ROOT_DIR}/logs/settler-b.log" 2>&1 &
PID_SET_B=$!

sleep 4
if ! kill -0 "${PID_SET_A}" 2>/dev/null; then
  echo "ERROR: settler A died"; tail -30 "${ROOT_DIR}/logs/settler-a.log" >&2; exit 1
fi
if ! kill -0 "${PID_SET_B}" 2>/dev/null; then
  echo "ERROR: settler B died"; tail -30 "${ROOT_DIR}/logs/settler-b.log" >&2; exit 1
fi

QUESTION='Was the Ethereum genesis block mined on July 30, 2015?'
echo "[7/8] injecting question to settler A only (auto-propagates)..."
echo "      prompt: ${QUESTION}"

QID_OUT=$(cd "${SETTLER_DIR}" && \
  "${PY}" tools/inject_question.py \
    --axl http://127.0.0.1:9002 \
    --target-pubkey "${PUB_A}" \
    --prompt "${QUESTION}" \
    --outcomes 0,1 \
    --deadline-secs 180 2>&1)
QID_HEX=$(echo "${QID_OUT}" | grep -oE "[a-f0-9]{64}" | head -1)
echo "      question_id: ${QID_HEX}"

echo "[8/8] waiting up to 90s for ONCHAIN tx in either settler log..."
for _ in $(seq 1 90); do
  if grep -q "ONCHAIN q=" "${ROOT_DIR}/logs/settler-a.log" 2>/dev/null \
     || grep -q "ONCHAIN q=" "${ROOT_DIR}/logs/settler-b.log" 2>/dev/null; then
    break
  fi
  sleep 1
done

echo
echo "=== relevant log lines ==="
grep -hE "CONSENSUS |ONCHAIN q=|inference q=|accepted vote q=" \
  "${ROOT_DIR}/logs/settler-a.log" "${ROOT_DIR}/logs/settler-b.log" | sort -u

echo
echo "=== verifying on-chain state ==="
SETTLED=$(cast call "${REG_ADDR}" "isSettled(bytes32)(bool)" "0x${QID_HEX}" --rpc-url "${RPC_URL}")
echo "isSettled(${QID_HEX:0:16}..): ${SETTLED}"

if [[ "${SETTLED}" != "true" ]]; then
  echo "ERROR: settlement not recorded on-chain" >&2
  echo "--- settler-a.log tail ---" >&2; tail -30 "${ROOT_DIR}/logs/settler-a.log" >&2
  echo "--- settler-b.log tail ---" >&2; tail -30 "${ROOT_DIR}/logs/settler-b.log" >&2
  exit 1
fi

# Read the full Settlement struct
SETTLEMENT=$(cast call "${REG_ADDR}" \
  "getSettlement(bytes32)((bytes32,uint8,uint256,uint256,bytes,address,uint256))" \
  "0x${QID_HEX}" --rpc-url "${RPC_URL}")
echo "Settlement: ${SETTLEMENT}"

echo
echo "ONCHAIN INTEGRATION OK"
