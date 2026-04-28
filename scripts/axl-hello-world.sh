#!/usr/bin/env bash
# Smoke test: run two AXL nodes on localhost and verify cross-node messaging.
#
# Prereq:
#   - AXL node binary built at axl/axl-node (or axl/axl-node.exe on Windows)
#   - Keys generated via scripts/axl-keygen.sh node-a / node-b
#
# Output: prints message round-trip result; exits 0 on success.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

# Pick the right binary for the platform
if [[ -f axl/axl-node.exe ]]; then
  AXL_BIN="./axl/axl-node.exe"
elif [[ -f axl/axl-node ]]; then
  AXL_BIN="./axl/axl-node"
else
  echo "error: axl-node binary not found in axl/" >&2
  exit 1
fi

# Ensure keys exist
[[ -f keys/node-a.pem ]] || scripts/axl-keygen.sh node-a
[[ -f keys/node-b.pem ]] || scripts/axl-keygen.sh node-b

# Launch the two nodes from inside their config directory so relative paths resolve
mkdir -p logs
cd configs/local

echo "starting node A (api:9002, tcp:9001)..."
"${ROOT_DIR}/${AXL_BIN#./}" -config node-a.json > "${ROOT_DIR}/logs/node-a.log" 2>&1 &
PID_A=$!

echo "starting node B (api:9012, tcp:7001)..."
"${ROOT_DIR}/${AXL_BIN#./}" -config node-b.json > "${ROOT_DIR}/logs/node-b.log" 2>&1 &
PID_B=$!

cleanup() {
  kill "${PID_A}" "${PID_B}" 2>/dev/null || true
  wait "${PID_A}" "${PID_B}" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for both API endpoints to be ready
echo "waiting for node A api on 9002..."
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:9002/topology >/dev/null 2>&1; then break; fi
  sleep 1
done
echo "waiting for node B api on 9012..."
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:9012/topology >/dev/null 2>&1; then break; fi
  sleep 1
done

NODE_A_KEY=$(curl -fsS http://127.0.0.1:9002/topology | python -c "import sys,json; print(json.load(sys.stdin)['our_public_key'])")
NODE_B_KEY=$(curl -fsS http://127.0.0.1:9012/topology | python -c "import sys,json; print(json.load(sys.stdin)['our_public_key'])")

echo "node A pubkey: ${NODE_A_KEY}"
echo "node B pubkey: ${NODE_B_KEY}"

# Give the mesh a moment to peer
sleep 3

PAYLOAD="hello from node B at $(date -u +%FT%TZ)"
echo "sending: ${PAYLOAD}"
curl -fsS -X POST "http://127.0.0.1:9012/send" \
  -H "X-Destination-Peer-Id: ${NODE_A_KEY}" \
  -d "${PAYLOAD}"
echo

# Poll for receipt on node A
echo "polling node A for incoming message..."
for _ in $(seq 1 10); do
  RESP=$(curl -fsS "http://127.0.0.1:9002/recv" 2>/dev/null || true)
  if [[ -n "${RESP}" && "${RESP}" != "null" ]]; then
    echo "RECEIVED: ${RESP}"
    echo "AXL hello world OK"
    exit 0
  fi
  sleep 1
done

echo "error: no message received on node A" >&2
echo "--- node-a.log tail ---" >&2
tail -20 "${ROOT_DIR}/logs/node-a.log" >&2 || true
echo "--- node-b.log tail ---" >&2
tail -20 "${ROOT_DIR}/logs/node-b.log" >&2 || true
exit 1
