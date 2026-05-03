#!/usr/bin/env bash
# Three-node Synod demo. Brings up:
#   - anvil local EVM chain
#   - SynodRegistry deployed + 3 settlers registered
#   - 3 local AXL nodes
#   - 3 settler agents, defaulting to Anthropic/OpenAI/Gemini
#   - Next.js UI on http://localhost:3000
#
# Defaults are optimized for a judged demo:
#   A = Anthropic claude-sonnet-4-6
#   B = OpenAI gpt-4o
#   C = Gemini gemini-2.0-flash
#
# Override providers/models with:
#   SYNOD_DEMO_B_PROVIDER=anthropic SYNOD_DEMO_B_MODEL=claude-sonnet-4-6 bash tools/demo-up-3node.sh
#
# For startup smoke tests that should tear down once ready:
#   SYNOD_DEMO_EXIT_AFTER_READY=1 bash tools/demo-up-3node.sh
#
# Anvil's deterministic test keys are publicly known fixtures. Never use them
# on a real chain.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SETTLER_DIR="${ROOT_DIR}/settler"
CONTRACTS_DIR="${ROOT_DIR}/contracts"
UI_DIR="${ROOT_DIR}/ui"
PY="${SETTLER_DIR}/.venv/Scripts/python.exe"
[[ -x "${PY}" ]] || PY="${SETTLER_DIR}/.venv/bin/python"
RUNTIME_CONFIG="${UI_DIR}/.synod-demo-runtime.json"

resolve_tool() {
  local name="$1"
  local candidate
  for candidate in "${name}" "${name}.exe"; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      command -v "${candidate}"
      return 0
    fi
  done
  for dir in "/c/Users/HP/.foundry/bin" "/mnt/c/Users/HP/.foundry/bin" "${HOME}/.foundry/bin"; do
    for candidate in "${dir}/${name}" "${dir}/${name}.exe"; do
      if [[ -x "${candidate}" ]]; then
        echo "${candidate}"
        return 0
      fi
    done
  done
  return 1
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

has_secret() {
  local key="$1"
  local value="${!key:-}"
  [[ -n "${value}" ]] || value="$(env_file_value "${key}")"
  [[ -n "${value}" ]]
}

require_provider_key() {
  local provider
  provider="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  case "${provider}" in
    anthropic)
      has_secret ANTHROPIC_API_KEY || { echo "ANTHROPIC_API_KEY missing in settler/.env"; exit 1; }
      ;;
    openai)
      has_secret OPENAI_API_KEY || { echo "OPENAI_API_KEY missing in settler/.env"; exit 1; }
      ;;
    gemini)
      has_secret GOOGLE_API_KEY || { echo "GOOGLE_API_KEY missing in settler/.env"; exit 1; }
      ;;
    deterministic)
      ;;
    *)
      echo "unknown provider '${provider}'. Expected anthropic, openai, gemini, or deterministic"
      exit 1
      ;;
  esac
}

to_windows_path() {
  local path="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "${path}"
  elif command -v wslpath >/dev/null 2>&1; then
    wslpath -w "${path}"
  else
    echo "${path}"
  fi
}

stop_stale_ui_dev() {
  local ui_win
  ui_win="$(to_windows_path "${UI_DIR}")"
  powershell.exe -NoProfile -Command '
$ui = $args[0]
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "node.exe" -and
  $_.CommandLine -and
  $_.CommandLine.Contains($ui) -and
  $_.CommandLine.Contains("next") -and
  $_.CommandLine.Contains("dev")
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
}
' "${ui_win}" >/dev/null 2>&1 || true
}

wait_for_http() {
  local url="$1"
  local seconds="${2:-30}"
  for _ in $(seq 1 "${seconds}"); do
    "${CURL_BIN}" -fsS "${url}" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

read_axl_pubkey() {
  local url="$1"
  "${CURL_BIN}" -fsS "${url}/topology" |
    "${PY}" -c "import sys,json;print(json.load(sys.stdin)['our_public_key'])" |
    tr -d '\r'
}

cd "${ROOT_DIR}"

[[ -x "${PY}" ]] || { echo "settler virtualenv Python missing; run the Quick start setup"; exit 1; }

FORGE_BIN="$(resolve_tool forge)" || { echo "forge missing; install Foundry or add it to PATH"; exit 1; }
CAST_BIN="$(resolve_tool cast)" || { echo "cast missing; install Foundry or add it to PATH"; exit 1; }
ANVIL_BIN="$(resolve_tool anvil)" || { echo "anvil missing; install Foundry or add it to PATH"; exit 1; }
CURL_BIN="$(command -v curl.exe 2>/dev/null || command -v curl 2>/dev/null)" || {
  echo "curl missing"
  exit 1
}

if [[ -f axl/axl-node.exe ]]; then AXL_BIN="${ROOT_DIR}/axl/axl-node.exe"
elif [[ -f axl/axl-node ]]; then AXL_BIN="${ROOT_DIR}/axl/axl-node"
else echo "axl binary missing; build Gensyn AXL first"; exit 1; fi

# Defaults match the live deployment — Anthropic Sonnet/Haiku + Google
# Gemini — so a judge running this from a fresh clone with just an
# ANTHROPIC_API_KEY and a GOOGLE_API_KEY can reproduce the demo. To swap
# B in for an OpenAI provider, export SYNOD_DEMO_B_PROVIDER=openai
# SYNOD_DEMO_B_MODEL=gpt-4o before running.
PROVIDER_A="${SYNOD_DEMO_A_PROVIDER:-anthropic}"
MODEL_A="${SYNOD_DEMO_A_MODEL:-claude-sonnet-4-6}"
PROVIDER_B="${SYNOD_DEMO_B_PROVIDER:-anthropic}"
MODEL_B="${SYNOD_DEMO_B_MODEL:-claude-haiku-4-5}"
PROVIDER_C="${SYNOD_DEMO_C_PROVIDER:-gemini}"
MODEL_C="${SYNOD_DEMO_C_MODEL:-gemini-2.5-flash}"
QUORUM="${SYNOD_DEMO_QUORUM:-2}"

require_provider_key "${PROVIDER_A}"
require_provider_key "${PROVIDER_B}"
require_provider_key "${PROVIDER_C}"

ANVIL_PORT=8545
RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
ACC0_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ACC0_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cfFFb92266"
ACC1_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
ACC1_ADDR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
ACC2_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
ACC2_ADDR="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
ACC3_KEY="0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
ACC3_ADDR="0x90F79bf6EB2c4f870365E785982E1f101E93b906"

mkdir -p logs keys
rm -f \
  "${ROOT_DIR}/logs/anvil.log" \
  "${ROOT_DIR}/logs/node-a.log" \
  "${ROOT_DIR}/logs/node-b.log" \
  "${ROOT_DIR}/logs/node-c.log" \
  "${ROOT_DIR}/logs/settler-a.log" \
  "${ROOT_DIR}/logs/settler-b.log" \
  "${ROOT_DIR}/logs/settler-c.log" \
  "${ROOT_DIR}/logs/ui.log"
if [[ ! -f "${ROOT_DIR}/keys/node-c.pem" ]]; then
  bash "${ROOT_DIR}/scripts/axl-keygen.sh" node-c
fi

echo "[demo3] cleaning previous run..."
stop_stale_ui_dev
taskkill //F //IM axl-node.exe >/dev/null 2>&1 || true
taskkill //F //IM anvil.exe >/dev/null 2>&1 || true
pkill -f run_settler.py >/dev/null 2>&1 || true
sleep 1

echo "[demo3] starting anvil on :${ANVIL_PORT}..."
"${ANVIL_BIN}" --port "${ANVIL_PORT}" --silent > "${ROOT_DIR}/logs/anvil.log" 2>&1 &
PID_ANVIL=$!
PID_AXL_A=""
PID_AXL_B=""
PID_AXL_C=""
PID_SET_A=""
PID_SET_B=""
PID_SET_C=""
PID_UI=""

cleanup() {
  echo
  echo "[demo3] shutting down..."
  [[ -n "${PID_UI}" ]] && kill "${PID_UI}" 2>/dev/null || true
  [[ -n "${PID_SET_A}" ]] && kill "${PID_SET_A}" 2>/dev/null || true
  [[ -n "${PID_SET_B}" ]] && kill "${PID_SET_B}" 2>/dev/null || true
  [[ -n "${PID_SET_C}" ]] && kill "${PID_SET_C}" 2>/dev/null || true
  [[ -n "${PID_AXL_A}" ]] && kill "${PID_AXL_A}" 2>/dev/null || true
  [[ -n "${PID_AXL_B}" ]] && kill "${PID_AXL_B}" 2>/dev/null || true
  [[ -n "${PID_AXL_C}" ]] && kill "${PID_AXL_C}" 2>/dev/null || true
  kill "${PID_ANVIL}" 2>/dev/null || true
  rm -f "${RUNTIME_CONFIG}" 2>/dev/null || true
  stop_stale_ui_dev
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 30); do
  "${CAST_BIN}" block-number --rpc-url "${RPC_URL}" >/dev/null 2>&1 && break
  sleep 1
done

echo "[demo3] deploying SynodRegistry..."
DEPLOY_OUT=$(cd "${CONTRACTS_DIR}" && \
  "${FORGE_BIN}" create \
    --rpc-url "${RPC_URL}" \
    --private-key "${ACC0_KEY}" \
    --broadcast \
    src/SynodRegistry.sol:SynodRegistry \
    --constructor-args "${ACC0_ADDR}" 2>&1 | tr -d '\000')
REG_ADDR=$(echo "${DEPLOY_OUT}" | grep -oE "Deployed to: 0x[a-fA-F0-9]{40}" | head -1 | awk '{print $3}')
[[ -n "${REG_ADDR}" ]] || { echo "deploy failed"; echo "${DEPLOY_OUT}" | tail -20; exit 1; }
echo "[demo3]   registry: ${REG_ADDR}"
printf '{"rpcUrl":"%s","registryAddress":"%s"}\n' "${RPC_URL}" "${REG_ADDR}" > "${RUNTIME_CONFIG}"

echo "[demo3] starting AXL nodes..."
( cd configs/local && "${AXL_BIN}" -config node-a.json > "${ROOT_DIR}/logs/node-a.log" 2>&1 ) &
PID_AXL_A=$!
( cd configs/local && "${AXL_BIN}" -config node-b.json > "${ROOT_DIR}/logs/node-b.log" 2>&1 ) &
PID_AXL_B=$!
( cd configs/local && "${AXL_BIN}" -config node-c.json > "${ROOT_DIR}/logs/node-c.log" 2>&1 ) &
PID_AXL_C=$!

wait_for_http http://127.0.0.1:9002/topology 30 &&
wait_for_http http://127.0.0.1:9012/topology 30 &&
wait_for_http http://127.0.0.1:9022/topology 30 || {
  echo "AXL topology failed"
  echo "--- node-a.log tail ---"; tail -30 "${ROOT_DIR}/logs/node-a.log" || true
  echo "--- node-b.log tail ---"; tail -30 "${ROOT_DIR}/logs/node-b.log" || true
  echo "--- node-c.log tail ---"; tail -30 "${ROOT_DIR}/logs/node-c.log" || true
  exit 1
}

PUB_A="$(read_axl_pubkey http://127.0.0.1:9002)"
PUB_B="$(read_axl_pubkey http://127.0.0.1:9012)"
PUB_C="$(read_axl_pubkey http://127.0.0.1:9022)"
if [[ -z "${PUB_A}" || -z "${PUB_B}" || -z "${PUB_C}" ]]; then
  echo "failed to read one or more AXL public keys"
  exit 1
fi
echo "[demo3]   node A: ${PUB_A:0:16}..."
echo "[demo3]   node B: ${PUB_B:0:16}..."
echo "[demo3]   node C: ${PUB_C:0:16}..."

echo "[demo3] registering settlers..."
for item in \
  "${ACC1_ADDR}|${PUB_A}|${PROVIDER_A}-${MODEL_A}-A" \
  "${ACC2_ADDR}|${PUB_B}|${PROVIDER_B}-${MODEL_B}-B" \
  "${ACC3_ADDR}|${PUB_C}|${PROVIDER_C}-${MODEL_C}-C"; do
  IFS='|' read -r addr pub model_tag <<< "${item}"
  REG_OUT=$("${CAST_BIN}" send "${REG_ADDR}" "registerSettler(address,bytes32,string)" \
    "${addr}" "0x${pub}" "${model_tag}" \
    --rpc-url "${RPC_URL}" --private-key "${ACC0_KEY}" 2>&1) || {
    echo "registerSettler failed for ${addr}"
    echo "${REG_OUT}" | tail -20
    exit 1
  }
done
REG_COUNT=$("${CAST_BIN}" call "${REG_ADDR}" "registeredSettlerCount()(uint256)" --rpc-url "${RPC_URL}" | tr -d '\r')
echo "[demo3]   registered settlers: ${REG_COUNT}"

echo "[demo3] mesh routes converging..."
sleep 15

KEY_A="${ROOT_DIR}/keys/node-a.pem"
KEY_B="${ROOT_DIR}/keys/node-b.pem"
KEY_C="${ROOT_DIR}/keys/node-c.pem"

start_settler() {
  local label="$1"
  local provider="$2"
  local model="$3"
  local axl_url="$4"
  local identity_key="$5"
  local peer_keys="$6"
  local evm_key="$7"
  local log_file="$8"

  (
    cd "${SETTLER_DIR}" || exit 1
    "${PY}" tools/run_settler.py \
      --provider "${provider}" \
      --model "${model}" \
      --axl "${axl_url}" \
      --identity-key "${identity_key}" \
      --peer-keys "${peer_keys}" \
      --quorum "${QUORUM}" \
      --rpc-url "${RPC_URL}" \
      --registry-address "${REG_ADDR}" \
      --evm-key "${evm_key}" \
      --log-level INFO
  ) > "${log_file}" 2>&1 &
}

echo "[demo3] starting settler agents..."
start_settler A "${PROVIDER_A}" "${MODEL_A}" "http://127.0.0.1:9002" "${KEY_A}" "${PUB_B},${PUB_C}" "${ACC1_KEY}" "${ROOT_DIR}/logs/settler-a.log"
PID_SET_A=$!
start_settler B "${PROVIDER_B}" "${MODEL_B}" "http://127.0.0.1:9012" "${KEY_B}" "${PUB_A},${PUB_C}" "${ACC2_KEY}" "${ROOT_DIR}/logs/settler-b.log"
PID_SET_B=$!
start_settler C "${PROVIDER_C}" "${MODEL_C}" "http://127.0.0.1:9022" "${KEY_C}" "${PUB_A},${PUB_B}" "${ACC3_KEY}" "${ROOT_DIR}/logs/settler-c.log"
PID_SET_C=$!

sleep 4
for item in \
  "A|${PID_SET_A}|${ROOT_DIR}/logs/settler-a.log" \
  "B|${PID_SET_B}|${ROOT_DIR}/logs/settler-b.log" \
  "C|${PID_SET_C}|${ROOT_DIR}/logs/settler-c.log"; do
  IFS='|' read -r label pid log_file <<< "${item}"
  if ! kill -0 "${pid}" 2>/dev/null; then
    echo "settler ${label} failed to start"
    tail -50 "${log_file}" 2>/dev/null || true
    exit 1
  fi
done

echo "[demo3] starting Next.js UI on :3000..."
(
  UI_WIN="$(to_windows_path "${UI_DIR}")"
  RUNTIME_WIN="$(to_windows_path "${RUNTIME_CONFIG}")"
  INJECT_TARGETS="http://127.0.0.1:9002|${PUB_A};http://127.0.0.1:9012|${PUB_B};http://127.0.0.1:9022|${PUB_C}"
  powershell.exe -NoProfile -Command "Set-Location -LiteralPath '${UI_WIN}'; \$env:SYNOD_UI_DISABLE_ENS='1'; \$env:SYNOD_RPC_URL='${RPC_URL}'; \$env:SYNOD_REGISTRY_ADDRESS='${REG_ADDR}'; \$env:SYNOD_DEMO_RUNTIME_CONFIG='${RUNTIME_WIN}'; \$env:SYNOD_UI_INJECT_TARGETS='${INJECT_TARGETS}'; npm.cmd run dev -- --webpack"
) > "${ROOT_DIR}/logs/ui.log" 2>&1 &
PID_UI=$!

echo -n "[demo3] waiting for UI"
UI_READY=0
for _ in $(seq 1 60); do
  if "${CURL_BIN}" -fsS http://127.0.0.1:3000 >/dev/null 2>&1; then
    echo " ok"
    UI_READY=1
    break
  fi
  echo -n "."
  sleep 1
done
if [[ "${UI_READY}" -ne 1 ]]; then
  echo
  echo "UI did not become ready"
  tail -50 "${ROOT_DIR}/logs/ui.log" 2>/dev/null || true
  exit 1
fi

cat <<EOF

================================================================
 SYNOD 3-NODE DEMO READY
================================================================
  UI:                http://localhost:3000
  SynodRegistry:     ${REG_ADDR}
  Anvil RPC:         ${RPC_URL}
  Quorum:            ${QUORUM} of 3

  Settler A:         ${PROVIDER_A} / ${MODEL_A}
  Settler B:         ${PROVIDER_B} / ${MODEL_B}
  Settler C:         ${PROVIDER_C} / ${MODEL_C}

  Settler A pubkey:  ${PUB_A}
  Settler B pubkey:  ${PUB_B}
  Settler C pubkey:  ${PUB_C}

  logs/node-a.log       AXL daemon node A
  logs/node-b.log       AXL daemon node B
  logs/node-c.log       AXL daemon node C
  logs/settler-a.log    Synod settler A
  logs/settler-b.log    Synod settler B
  logs/settler-c.log    Synod settler C
  logs/ui.log           Next.js dev server

  Open the UI, inject a market resolution question, then verify the posted
  proof independently with:

    cd settler
    python tools/verify_settlement.py --rpc-url ${RPC_URL} --registry-address ${REG_ADDR} --question-id <question_id>

  Ctrl-C in this terminal to tear everything down.
================================================================
EOF

if [[ "${SYNOD_DEMO_EXIT_AFTER_READY:-}" == "1" ]]; then
  echo "[demo3] SYNOD_DEMO_EXIT_AFTER_READY=1; stopping after readiness check."
  exit 0
fi

while true; do
  sleep 30
  if ! "${CURL_BIN}" -fsS http://127.0.0.1:9002/topology >/dev/null 2>&1; then
    echo "[demo3] WARNING: AXL node A unreachable"
  fi
  if ! "${CURL_BIN}" -fsS http://127.0.0.1:9012/topology >/dev/null 2>&1; then
    echo "[demo3] WARNING: AXL node B unreachable"
  fi
  if ! "${CURL_BIN}" -fsS http://127.0.0.1:9022/topology >/dev/null 2>&1; then
    echo "[demo3] WARNING: AXL node C unreachable"
  fi
done
