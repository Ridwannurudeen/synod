#!/usr/bin/env bash
# End-to-end 2-agent deliberation smoke test.
#
# Orchestration:
#   1. Start two local AXL nodes (node-a, node-b) and wait for their APIs.
#   2. Discover each node's pubkey via /topology.
#   3. Run two settler agents in the background, each pointed at one AXL daemon
#      with the other node's pubkey as its peer.
#   4. Inject a question to BOTH settlers.
#   5. Wait, then dump settler logs to verify both ran inference, exchanged
#      signed votes, and emitted CONSENSUS.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SETTLER_DIR="${ROOT_DIR}/settler"
PY="${SETTLER_DIR}/.venv/Scripts/python.exe"
[[ -x "${PY}" ]] || PY="${SETTLER_DIR}/.venv/bin/python"

cd "${ROOT_DIR}"

# Load the API key out of settler/.env without sourcing the whole file
# (the file may contain values with spaces that break shell `source`).
ANTHROPIC_API_KEY="$(grep -E '^ANTHROPIC_API_KEY=' "${SETTLER_DIR}/.env" | sed 's/^[^=]*=//')"
SYNOD_PROVIDER="$(grep -E '^SYNOD_PROVIDER=' "${SETTLER_DIR}/.env" | sed 's/^[^=]*=//' || echo anthropic)"
SYNOD_MODEL="$(grep -E '^SYNOD_MODEL=' "${SETTLER_DIR}/.env" | sed 's/^[^=]*=//' || echo claude-sonnet-4-6)"

if [[ -z "${ANTHROPIC_API_KEY}" ]]; then
  echo "ERROR: ANTHROPIC_API_KEY not found in ${SETTLER_DIR}/.env" >&2
  exit 1
fi

# Pick AXL binary
if [[ -f axl/axl-node.exe ]]; then AXL_BIN="${ROOT_DIR}/axl/axl-node.exe"
elif [[ -f axl/axl-node ]]; then AXL_BIN="${ROOT_DIR}/axl/axl-node"
else echo "axl binary missing"; exit 1; fi

mkdir -p logs

# Clean any prior runs
taskkill //F //IM axl-node.exe >/dev/null 2>&1 || true
pkill -f run_settler.py >/dev/null 2>&1 || true
sleep 1

echo "[1/5] starting AXL node A (api 9002)..."
( cd configs/local && "${AXL_BIN}" -config node-a.json > "${ROOT_DIR}/logs/node-a.log" 2>&1 ) &
PID_AXL_A=$!

echo "[1/5] starting AXL node B (api 9012)..."
( cd configs/local && "${AXL_BIN}" -config node-b.json > "${ROOT_DIR}/logs/node-b.log" 2>&1 ) &
PID_AXL_B=$!

cleanup() {
  echo "cleaning up..."
  kill "${PID_AXL_A}" "${PID_AXL_B}" 2>/dev/null || true
  pkill -f run_settler.py >/dev/null 2>&1 || true
  taskkill //F //IM axl-node.exe >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Wait for both APIs
for url in http://127.0.0.1:9002 http://127.0.0.1:9012; do
  for _ in $(seq 1 30); do
    curl -fsS "${url}/topology" >/dev/null 2>&1 && break
    sleep 1
  done
done

PUB_A=$(curl -fsS http://127.0.0.1:9002/topology | "${PY}" -c "import sys,json;print(json.load(sys.stdin)['our_public_key'])")
PUB_B=$(curl -fsS http://127.0.0.1:9012/topology | "${PY}" -c "import sys,json;print(json.load(sys.stdin)['our_public_key'])")
echo "[2/5] node A pubkey: ${PUB_A}"
echo "[2/5] node B pubkey: ${PUB_B}"

# Allow mesh routes to converge
echo "[3/5] waiting for mesh routes..."
sleep 12

KEY_A="${ROOT_DIR}/keys/node-a.pem"
KEY_B="${ROOT_DIR}/keys/node-b.pem"

# Confirm key files exist (paths with spaces are fine when quoted)
[[ -f "${KEY_A}" ]] || { echo "missing key: ${KEY_A}"; exit 1; }
[[ -f "${KEY_B}" ]] || { echo "missing key: ${KEY_B}"; exit 1; }

echo "[3/5] starting settler A (Anthropic ${SYNOD_MODEL}, identity node-a)..."
(
  cd "${SETTLER_DIR}" && \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  SYNOD_PROVIDER="${SYNOD_PROVIDER}" \
  SYNOD_MODEL="${SYNOD_MODEL}" \
  SYNOD_AXL_API="http://127.0.0.1:9002" \
  SYNOD_IDENTITY_KEY="${KEY_A}" \
  SYNOD_PEER_KEYS="${PUB_B}" \
  SYNOD_QUORUM=2 \
  SYNOD_LOG_LEVEL=INFO \
  "${PY}" tools/run_settler.py
) > "${ROOT_DIR}/logs/settler-a.log" 2>&1 &
PID_SET_A=$!

echo "[3/5] starting settler B (Anthropic ${SYNOD_MODEL}, identity node-b)..."
(
  cd "${SETTLER_DIR}" && \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  SYNOD_PROVIDER="${SYNOD_PROVIDER}" \
  SYNOD_MODEL="${SYNOD_MODEL}" \
  SYNOD_AXL_API="http://127.0.0.1:9012" \
  SYNOD_IDENTITY_KEY="${KEY_B}" \
  SYNOD_PEER_KEYS="${PUB_A}" \
  SYNOD_QUORUM=2 \
  SYNOD_LOG_LEVEL=INFO \
  "${PY}" tools/run_settler.py
) > "${ROOT_DIR}/logs/settler-b.log" 2>&1 &
PID_SET_B=$!

# Settlers boot quickly; give them a moment to attach to AXL
sleep 4

if ! kill -0 "${PID_SET_A}" 2>/dev/null; then
  echo "ERROR: settler A died on startup"; tail -30 "${ROOT_DIR}/logs/settler-a.log" >&2; exit 1
fi
if ! kill -0 "${PID_SET_B}" 2>/dev/null; then
  echo "ERROR: settler B died on startup"; tail -30 "${ROOT_DIR}/logs/settler-b.log" >&2; exit 1
fi

QUESTION='Was the Bitcoin genesis block mined on January 3, 2009?'
echo "[4/5] injecting question to settler A ONLY (auto-propagates to B over AXL)..."
echo "      prompt: ${QUESTION}"

(
  cd "${SETTLER_DIR}" && \
  "${PY}" tools/inject_question.py \
    --axl http://127.0.0.1:9002 \
    --target-pubkey "${PUB_A}" \
    --prompt "${QUESTION}" \
    --outcomes 0,1 \
    --deadline-secs 120
)

# Both settlers will independently infer, sign, broadcast, collect, emit
# consensus. Sonnet inference is ~3-6 seconds. Vote propagation is
# ~2-3 seconds across local AXL. Allow up to 60 seconds.
echo "[5/5] waiting up to 60s for CONSENSUS in both logs..."
for _ in $(seq 1 60); do
  CA=$(grep -c "CONSENSUS " "${ROOT_DIR}/logs/settler-a.log" 2>/dev/null | head -1 | tr -d '[:space:]')
  CB=$(grep -c "CONSENSUS " "${ROOT_DIR}/logs/settler-b.log" 2>/dev/null | head -1 | tr -d '[:space:]')
  CA="${CA:-0}"; CB="${CB:-0}"
  if [[ "${CA}" -ge 1 && "${CB}" -ge 1 ]]; then
    echo
    echo "=== settler-a relevant log lines ==="
    grep -E "CONSENSUS |inference q=|accepted vote q=|broadcast vote" "${ROOT_DIR}/logs/settler-a.log" | tail -10
    echo
    echo "=== settler-b relevant log lines ==="
    grep -E "CONSENSUS |inference q=|accepted vote q=|broadcast vote" "${ROOT_DIR}/logs/settler-b.log" | tail -10
    echo
    echo "2-AGENT DELIBERATION OK"
    exit 0
  fi
  sleep 1
done

echo "TIMEOUT: settlers did not both reach consensus" >&2
echo "--- settler-a.log tail ---" >&2; tail -40 "${ROOT_DIR}/logs/settler-a.log" >&2 || true
echo "--- settler-b.log tail ---" >&2; tail -40 "${ROOT_DIR}/logs/settler-b.log" >&2 || true
exit 1
