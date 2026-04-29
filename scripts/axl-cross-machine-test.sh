#!/usr/bin/env bash
# Cross-machine smoke test: local AXL node ↔ remote AXL node on VPS.
#
# Prereq:
#   - Local node-local.pem key generated and configs/local/node-local.json present
#   - VPS node already running (axl-node bound to 0.0.0.0:9001, tcp_port 7000)
#
# Sets up two-way messaging:
#   - Local sends a message to VPS
#   - VPS sends a message to local
#   - Both verify receipt

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ -z "${VPS_HOST:-}" ]]; then
  echo "error: set VPS_HOST=user@host for the remote AXL node" >&2
  exit 1
fi
if [[ -z "${VPS_PEER_URL:-}" ]]; then
  echo "error: set VPS_PEER_URL=tls://host-or-ip:9001 for the remote AXL peer" >&2
  exit 1
fi
VPS_API="http://127.0.0.1:9002"        # over SSH
LOCAL_API="http://127.0.0.1:9022"

# Pick local AXL binary
if [[ -f axl/axl-node.exe ]]; then
  AXL_BIN="${ROOT_DIR}/axl/axl-node.exe"
elif [[ -f axl/axl-node ]]; then
  AXL_BIN="${ROOT_DIR}/axl/axl-node"
else
  echo "error: axl-node binary not found" >&2; exit 1
fi

[[ -f keys/node-local.pem ]] || scripts/axl-keygen.sh node-local

# Verify VPS node is up
echo "checking VPS node..."
VPS_PUBKEY=$(ssh -o ConnectTimeout=5 "${VPS_HOST}" "curl -fsS ${VPS_API}/topology" | python -c "import sys,json; print(json.load(sys.stdin)['our_public_key'])" | tr -d '\r')
if [[ -z "${VPS_PUBKEY}" ]]; then
  echo "error: could not reach VPS AXL node" >&2; exit 1
fi
echo "VPS pubkey: ${VPS_PUBKEY}"

# Start local node
mkdir -p logs
LOCAL_CONFIG="${ROOT_DIR}/logs/node-local.remote.json"
cat > "${LOCAL_CONFIG}" <<EOF
{
  "PrivateKeyPath": "../keys/node-local.pem",
  "Peers": ["${VPS_PEER_URL}"],
  "Listen": [],
  "api_port": 9022,
  "tcp_port": 7000
}
EOF
cd logs
echo "starting local node (api:9022, peering to VPS)..."
"${AXL_BIN}" -config node-local.remote.json > "${ROOT_DIR}/logs/node-local.log" 2>&1 &
PID_LOCAL=$!
trap 'kill "${PID_LOCAL}" 2>/dev/null || true' EXIT
cd "${ROOT_DIR}"

# Wait for local API
for _ in $(seq 1 30); do
  if curl -fsS "${LOCAL_API}/topology" >/dev/null 2>&1; then break; fi
  sleep 1
done
LOCAL_PUBKEY=$(curl -fsS "${LOCAL_API}/topology" | python -c "import sys,json; print(json.load(sys.stdin)['our_public_key'])" | tr -d '\r')
echo "local pubkey: ${LOCAL_PUBKEY}"

# Wait for mesh routes
echo "waiting for mesh routes to converge across machines..."
sleep 12

# Test 1: local -> VPS
PAYLOAD_LOCAL_TO_VPS="hello from local at $(date -u +%FT%TZ)"
echo "[test 1] local -> VPS: ${PAYLOAD_LOCAL_TO_VPS}"
SENT=0
for attempt in $(seq 1 20); do
  if curl -fsS -X POST "${LOCAL_API}/send" \
       -H "X-Destination-Peer-Id: ${VPS_PUBKEY}" \
       -d "${PAYLOAD_LOCAL_TO_VPS}" >/dev/null 2>&1; then
    SENT=1; echo "  send accepted on attempt ${attempt}"; break
  fi
  sleep 2
done
if [[ "${SENT}" -ne 1 ]]; then
  echo "ERROR: local -> VPS send failed" >&2
  echo "--- node-local.log tail ---" >&2; tail -30 "${ROOT_DIR}/logs/node-local.log" >&2 || true
  exit 1
fi

# Verify on VPS recv
echo "  polling VPS recv..."
for _ in $(seq 1 30); do
  RESP=$(ssh -o ConnectTimeout=5 "${VPS_HOST}" "curl -fsS ${VPS_API}/recv" 2>/dev/null || true)
  if [[ -n "${RESP}" && "${RESP}" != "null" ]]; then
    echo "  VPS RECEIVED: ${RESP}"
    break
  fi
  sleep 1
done

# Test 2: VPS -> local
PAYLOAD_VPS_TO_LOCAL="hello from VPS at $(date -u +%FT%TZ)"
echo "[test 2] VPS -> local: ${PAYLOAD_VPS_TO_LOCAL}"
SENT=0
for attempt in $(seq 1 20); do
  if ssh -o ConnectTimeout=5 "${VPS_HOST}" "curl -fsS -X POST ${VPS_API}/send -H 'X-Destination-Peer-Id: ${LOCAL_PUBKEY}' -d '${PAYLOAD_VPS_TO_LOCAL}'" >/dev/null 2>&1; then
    SENT=1; echo "  send accepted on attempt ${attempt}"; break
  fi
  sleep 2
done
if [[ "${SENT}" -ne 1 ]]; then
  echo "ERROR: VPS -> local send failed" >&2
  exit 1
fi

# Verify local recv
echo "  polling local recv..."
for _ in $(seq 1 30); do
  RESP=$(curl -fsS "${LOCAL_API}/recv" 2>/dev/null || true)
  if [[ -n "${RESP}" && "${RESP}" != "null" ]]; then
    echo "  LOCAL RECEIVED: ${RESP}"
    echo
    echo "AXL cross-machine round-trip OK"
    exit 0
  fi
  sleep 1
done

echo "ERROR: local did not receive VPS->local message" >&2
exit 1
