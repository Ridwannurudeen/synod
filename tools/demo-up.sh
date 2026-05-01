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

FORGE_BIN="$(resolve_tool forge)" || { echo "forge missing; install Foundry or add it to PATH"; exit 1; }
CAST_BIN="$(resolve_tool cast)" || { echo "cast missing; install Foundry or add it to PATH"; exit 1; }
ANVIL_BIN="$(resolve_tool anvil)" || { echo "anvil missing; install Foundry or add it to PATH"; exit 1; }
CURL_BIN="$(command -v curl.exe 2>/dev/null || command -v curl 2>/dev/null)" || {
  echo "curl missing"
  exit 1
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

cd "${ROOT_DIR}"

ANVIL_PORT=8545
RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
ACC0_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ACC0_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cfFFb92266"
ACC1_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
ACC1_ADDR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
ACC2_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
ACC2_ADDR="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

SYNOD_PROVIDER="$(env_or_file SYNOD_PROVIDER anthropic)"
SYNOD_MODEL="$(env_or_file SYNOD_MODEL "$(default_model_for_provider "${SYNOD_PROVIDER}")")"
require_provider_key "${SYNOD_PROVIDER}"

if [[ -f axl/axl-node.exe ]]; then AXL_BIN="${ROOT_DIR}/axl/axl-node.exe"
elif [[ -f axl/axl-node ]]; then AXL_BIN="${ROOT_DIR}/axl/axl-node"
else echo "axl binary missing — run scripts/axl-keygen.sh and forge build first"; exit 1; fi

mkdir -p logs
rm -f \
  "${ROOT_DIR}/logs/anvil.log" \
  "${ROOT_DIR}/logs/node-a.log" \
  "${ROOT_DIR}/logs/node-b.log" \
  "${ROOT_DIR}/logs/node-c.log" \
  "${ROOT_DIR}/logs/settler-a.log" \
  "${ROOT_DIR}/logs/settler-b.log" \
  "${ROOT_DIR}/logs/settler-c.log" \
  "${ROOT_DIR}/logs/ui.log"

echo "[demo] cleaning previous run..."
stop_stale_ui_dev
taskkill //F //IM axl-node.exe >/dev/null 2>&1 || true
taskkill //F //IM anvil.exe >/dev/null 2>&1 || true
pkill -f run_settler.py >/dev/null 2>&1 || true
sleep 1

echo "[demo] starting anvil on :${ANVIL_PORT}..."
"${ANVIL_BIN}" --port "${ANVIL_PORT}" --silent > "${ROOT_DIR}/logs/anvil.log" 2>&1 &
PID_ANVIL=$!
PID_AXL_A=""
PID_AXL_B=""
PID_SET_A=""
PID_SET_B=""
PID_UI=""

cleanup() {
  echo
  echo "[demo] shutting down..."
  [[ -n "${PID_UI}" ]] && kill "${PID_UI}" 2>/dev/null || true
  [[ -n "${PID_SET_A}" ]] && kill "${PID_SET_A}" 2>/dev/null || true
  [[ -n "${PID_SET_B}" ]] && kill "${PID_SET_B}" 2>/dev/null || true
  [[ -n "${PID_AXL_A}" ]] && kill "${PID_AXL_A}" 2>/dev/null || true
  [[ -n "${PID_AXL_B}" ]] && kill "${PID_AXL_B}" 2>/dev/null || true
  kill "${PID_ANVIL}" 2>/dev/null || true
  rm -f "${RUNTIME_CONFIG}" 2>/dev/null || true
  stop_stale_ui_dev
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 30); do
  "${CAST_BIN}" block-number --rpc-url "${RPC_URL}" >/dev/null 2>&1 && break
  sleep 1
done

echo "[demo] deploying SynodRegistry..."
DEPLOY_OUT=$(cd "${CONTRACTS_DIR}" && \
  "${FORGE_BIN}" create \
    --rpc-url "${RPC_URL}" \
    --private-key "${ACC0_KEY}" \
    --broadcast \
    src/SynodRegistry.sol:SynodRegistry \
    --constructor-args "${ACC0_ADDR}" 2>&1 | tr -d '\000')
REG_ADDR=$(echo "${DEPLOY_OUT}" | grep -oE "Deployed to: 0x[a-fA-F0-9]{40}" | head -1 | awk '{print $3}')
[[ -n "${REG_ADDR}" ]] || { echo "deploy failed"; echo "${DEPLOY_OUT}" | tail -20; exit 1; }
echo "[demo]   registry: ${REG_ADDR}"
printf '{"rpcUrl":"%s","registryAddress":"%s"}\n' "${RPC_URL}" "${REG_ADDR}" > "${RUNTIME_CONFIG}"

echo "[demo] starting AXL nodes..."
( cd configs/local && "${AXL_BIN}" -config node-a.json > "${ROOT_DIR}/logs/node-a.log" 2>&1 ) &
PID_AXL_A=$!
( cd configs/local && "${AXL_BIN}" -config node-b.json > "${ROOT_DIR}/logs/node-b.log" 2>&1 ) &
PID_AXL_B=$!

for _ in $(seq 1 30); do
  "${CURL_BIN}" -fsS http://127.0.0.1:9002/topology >/dev/null 2>&1 && \
  "${CURL_BIN}" -fsS http://127.0.0.1:9012/topology >/dev/null 2>&1 && break
  sleep 1
done

PUB_A=$("${CURL_BIN}" -fsS http://127.0.0.1:9002/topology | "${PY}" -c "import sys,json;print(json.load(sys.stdin)['our_public_key'])" | tr -d '\r')
PUB_B=$("${CURL_BIN}" -fsS http://127.0.0.1:9012/topology | "${PY}" -c "import sys,json;print(json.load(sys.stdin)['our_public_key'])" | tr -d '\r')
if [[ -z "${PUB_A}" || -z "${PUB_B}" ]]; then
  echo "AXL topology failed"
  echo "--- node-a.log tail ---"; tail -30 "${ROOT_DIR}/logs/node-a.log" || true
  echo "--- node-b.log tail ---"; tail -30 "${ROOT_DIR}/logs/node-b.log" || true
  exit 1
fi
echo "[demo]   node A: ${PUB_A:0:16}…"
echo "[demo]   node B: ${PUB_B:0:16}…"

echo "[demo] registering settlers..."
REG_A_OUT=$("${CAST_BIN}" send "${REG_ADDR}" "registerSettler(address,bytes32,string)" \
  "${ACC1_ADDR}" "0x${PUB_A}" "${SYNOD_PROVIDER}-${SYNOD_MODEL}-A" \
  --rpc-url "${RPC_URL}" --private-key "${ACC0_KEY}" 2>&1) || {
  echo "registerSettler A failed"
  echo "${REG_A_OUT}" | tail -20
  exit 1
}
REG_B_OUT=$("${CAST_BIN}" send "${REG_ADDR}" "registerSettler(address,bytes32,string)" \
  "${ACC2_ADDR}" "0x${PUB_B}" "${SYNOD_PROVIDER}-${SYNOD_MODEL}-B" \
  --rpc-url "${RPC_URL}" --private-key "${ACC0_KEY}" 2>&1) || {
  echo "registerSettler B failed"
  echo "${REG_B_OUT}" | tail -20
  exit 1
}
REG_COUNT=$("${CAST_BIN}" call "${REG_ADDR}" "registeredSettlerCount()(uint256)" --rpc-url "${RPC_URL}" | tr -d '\r')
echo "[demo]   registered settlers: ${REG_COUNT}"

echo "[demo] mesh routes converging..."
sleep 12

KEY_A="${ROOT_DIR}/keys/node-a.pem"
KEY_B="${ROOT_DIR}/keys/node-b.pem"

echo "[demo] starting settler agents..."
(
  cd "${SETTLER_DIR}" || exit 1
  "${PY}" tools/run_settler.py \
    --provider "${SYNOD_PROVIDER}" \
    --model "${SYNOD_MODEL}" \
    --axl "http://127.0.0.1:9002" \
    --identity-key "${KEY_A}" \
    --peer-keys "${PUB_B}" \
    --quorum 2 \
    --rpc-url "${RPC_URL}" \
    --registry-address "${REG_ADDR}" \
    --evm-key "${ACC1_KEY}" \
    --log-level INFO
) > "${ROOT_DIR}/logs/settler-a.log" 2>&1 &
PID_SET_A=$!

(
  cd "${SETTLER_DIR}" || exit 1
  "${PY}" tools/run_settler.py \
    --provider "${SYNOD_PROVIDER}" \
    --model "${SYNOD_MODEL}" \
    --axl "http://127.0.0.1:9012" \
    --identity-key "${KEY_B}" \
    --peer-keys "${PUB_A}" \
    --quorum 2 \
    --rpc-url "${RPC_URL}" \
    --registry-address "${REG_ADDR}" \
    --evm-key "${ACC2_KEY}" \
    --log-level INFO
) > "${ROOT_DIR}/logs/settler-b.log" 2>&1 &
PID_SET_B=$!

sleep 4
if ! kill -0 "${PID_SET_A}" 2>/dev/null; then
  echo "settler A failed to start"
  tail -50 "${ROOT_DIR}/logs/settler-a.log" 2>/dev/null || true
  exit 1
fi
if ! kill -0 "${PID_SET_B}" 2>/dev/null; then
  echo "settler B failed to start"
  tail -50 "${ROOT_DIR}/logs/settler-b.log" 2>/dev/null || true
  exit 1
fi

echo "[demo] starting Next.js UI on :3000..."
(
  UI_WIN="$(to_windows_path "${UI_DIR}")"
  RUNTIME_WIN="$(to_windows_path "${RUNTIME_CONFIG}")"
  INJECT_TARGETS="http://127.0.0.1:9002|${PUB_A};http://127.0.0.1:9012|${PUB_B}"
  powershell.exe -NoProfile -Command "Set-Location -LiteralPath '${UI_WIN}'; \$env:SYNOD_UI_DISABLE_ENS='1'; \$env:SYNOD_RPC_URL='${RPC_URL}'; \$env:SYNOD_REGISTRY_ADDRESS='${REG_ADDR}'; \$env:SYNOD_DEMO_RUNTIME_CONFIG='${RUNTIME_WIN}'; \$env:SYNOD_UI_INJECT_TARGETS='${INJECT_TARGETS}'; npm.cmd run dev -- --webpack"
) > "${ROOT_DIR}/logs/ui.log" 2>&1 &
PID_UI=$!

# Wait for the UI dev server to be ready
echo -n "[demo] waiting for UI"
UI_READY=0
for _ in $(seq 1 60); do
  if "${CURL_BIN}" -fsS http://127.0.0.1:3000 >/dev/null 2>&1; then
    echo " ✓"
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
  logs/settler-a.log Synod settler A (${SYNOD_PROVIDER} ${SYNOD_MODEL})
  logs/settler-b.log Synod settler B (${SYNOD_PROVIDER} ${SYNOD_MODEL})
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
  if ! "${CURL_BIN}" -fsS http://127.0.0.1:9002/topology >/dev/null 2>&1; then
    echo "[demo] WARNING: AXL node A unreachable"
  fi
done
