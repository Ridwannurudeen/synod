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
CURL_BIN="$(command -v curl.exe 2>/dev/null || command -v curl 2>/dev/null)" || {
  echo "curl missing"
  exit 1
}

env_file_value() {
  local key="$1"
  local value=""
  if [[ -f "${SETTLER_DIR}/.env" ]]; then
    value="$(grep -E "^${key}=" "${SETTLER_DIR}/.env" | tail -1 | sed 's/^[^=]*=//' || true)"
  fi
  value="${value%$'\r'}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  echo "${value}"
}

env_or_file() {
  local key="$1"
  local default="${2:-}"
  local value="${!key:-}"
  [[ -n "${value}" ]] || value="$(env_file_value "${key}")"
  [[ -n "${value}" ]] || value="${default}"
  echo "${value}"
}

has_secret() {
  local key="$1"
  local value="${!key:-}"
  [[ -n "${value}" ]] || value="$(env_file_value "${key}")"
  [[ -n "${value}" ]]
}

default_model_for_provider() {
  case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
    anthropic) echo "claude-sonnet-4-6" ;;
    openai) echo "gpt-4o" ;;
    gemini) echo "gemini-2.0-flash" ;;
    deterministic) echo "deterministic-v1" ;;
    *) echo "" ;;
  esac
}

require_provider_key() {
  local provider
  provider="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  case "${provider}" in
    anthropic)
      has_secret ANTHROPIC_API_KEY || { echo "ERROR: ANTHROPIC_API_KEY not found in ${SETTLER_DIR}/.env" >&2; exit 1; }
      ;;
    openai)
      has_secret OPENAI_API_KEY || { echo "ERROR: OPENAI_API_KEY not found in ${SETTLER_DIR}/.env" >&2; exit 1; }
      ;;
    gemini)
      has_secret GOOGLE_API_KEY || { echo "ERROR: GOOGLE_API_KEY not found in ${SETTLER_DIR}/.env" >&2; exit 1; }
      ;;
    deterministic)
      ;;
    *)
      echo "ERROR: unknown provider '${provider}'. Expected anthropic, openai, gemini, or deterministic" >&2
      exit 1
      ;;
  esac
}

SYNOD_PROVIDER="$(env_or_file SYNOD_PROVIDER anthropic)"
SYNOD_MODEL="$(env_or_file SYNOD_MODEL "$(default_model_for_provider "${SYNOD_PROVIDER}")")"
require_provider_key "${SYNOD_PROVIDER}"

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
    "${CURL_BIN}" -fsS "${url}/topology" >/dev/null 2>&1 && break
    sleep 1
  done
done

PUB_A=$("${CURL_BIN}" -fsS http://127.0.0.1:9002/topology | "${PY}" -c "import sys,json;print(json.load(sys.stdin)['our_public_key'])" | tr -d '\r')
PUB_B=$("${CURL_BIN}" -fsS http://127.0.0.1:9012/topology | "${PY}" -c "import sys,json;print(json.load(sys.stdin)['our_public_key'])" | tr -d '\r')
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

echo "[3/5] starting settler A (${SYNOD_PROVIDER} ${SYNOD_MODEL}, identity node-a)..."
(
  cd "${SETTLER_DIR}" || exit 1
  "${PY}" tools/run_settler.py \
    --provider "${SYNOD_PROVIDER}" \
    --model "${SYNOD_MODEL}" \
    --axl "http://127.0.0.1:9002" \
    --identity-key "${KEY_A}" \
    --peer-keys "${PUB_B}" \
    --quorum 2 \
    --log-level INFO
) > "${ROOT_DIR}/logs/settler-a.log" 2>&1 &
PID_SET_A=$!

echo "[3/5] starting settler B (${SYNOD_PROVIDER} ${SYNOD_MODEL}, identity node-b)..."
(
  cd "${SETTLER_DIR}" || exit 1
  "${PY}" tools/run_settler.py \
    --provider "${SYNOD_PROVIDER}" \
    --model "${SYNOD_MODEL}" \
    --axl "http://127.0.0.1:9012" \
    --identity-key "${KEY_B}" \
    --peer-keys "${PUB_A}" \
    --quorum 2 \
    --log-level INFO
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
