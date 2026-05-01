#!/usr/bin/env bash
# Smoke-test the full 3-settler demo stack non-interactively.
#
# Uses the deterministic provider by default so CI and local audit runs exercise
# AXL, signed votes, quorum, on-chain settlement, and proof verification without
# relying on paid LLM APIs. Override SYNOD_DEMO_* providers to run live models.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UI_DIR="${ROOT_DIR}/ui"
PY="${ROOT_DIR}/settler/.venv/Scripts/python.exe"
[[ -x "${PY}" ]] || PY="${ROOT_DIR}/settler/.venv/bin/python"
cd "${ROOT_DIR}"

mkdir -p logs
CURL_BIN="$(command -v curl.exe 2>/dev/null || command -v curl 2>/dev/null)" || {
  echo "curl missing" >&2
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

stop_stale_settlers() {
  local root_win
  root_win="$(to_windows_path "${ROOT_DIR}")"
  powershell.exe -NoProfile -Command '
$root = $args[0]
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -like "python*.exe" -and
  $_.CommandLine -and
  $_.CommandLine.Contains($root) -and
  $_.CommandLine.Contains("run_settler.py")
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
}
' "${root_win}" >/dev/null 2>&1 || true
}

cleanup() {
  echo
  echo "[smoke3] tearing down..."
  if [[ -n "${DEMO_PID:-}" ]]; then
    kill "${DEMO_PID}" >/dev/null 2>&1 || true
    sleep 1
    kill -9 "${DEMO_PID}" >/dev/null 2>&1 || true
  fi
  pkill -f demo-up-3node.sh >/dev/null 2>&1 || true
  pkill -f run_settler.py >/dev/null 2>&1 || true
  stop_stale_settlers
  stop_stale_ui_dev
  taskkill //F //IM axl-node.exe >/dev/null 2>&1 || true
  taskkill //F //IM anvil.exe >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

stop_stale_ui_dev
stop_stale_settlers

echo "[smoke3] starting demo-up-3node.sh..."
SYNOD_DEMO_A_PROVIDER="${SYNOD_DEMO_A_PROVIDER:-deterministic}" \
SYNOD_DEMO_A_MODEL="${SYNOD_DEMO_A_MODEL:-deterministic-v1}" \
SYNOD_DEMO_B_PROVIDER="${SYNOD_DEMO_B_PROVIDER:-deterministic}" \
SYNOD_DEMO_B_MODEL="${SYNOD_DEMO_B_MODEL:-deterministic-v1}" \
SYNOD_DEMO_C_PROVIDER="${SYNOD_DEMO_C_PROVIDER:-deterministic}" \
SYNOD_DEMO_C_MODEL="${SYNOD_DEMO_C_MODEL:-deterministic-v1}" \
SYNOD_DEMO_QUORUM="${SYNOD_DEMO_QUORUM:-2}" \
SYNOD_DETERMINISTIC_OUTCOME="${SYNOD_DETERMINISTIC_OUTCOME:-1}" \
SYNOD_DETERMINISTIC_CONFIDENCE="${SYNOD_DETERMINISTIC_CONFIDENCE:-0.99}" \
bash tools/demo-up-3node.sh > "${ROOT_DIR}/logs/demo-up-3node.log" 2>&1 &
DEMO_PID=$!

echo -n "[smoke3] waiting for UI"
UI_READY=0
for _ in $(seq 1 150); do
  if "${CURL_BIN}" -fsS http://127.0.0.1:3000/api/state >/dev/null 2>&1; then
    UI_READY=1
    echo " ok"
    break
  fi
  echo -n "."
  sleep 1
done

if [[ "${UI_READY}" -ne 1 ]]; then
  echo
  echo "[smoke3] ERROR: UI never came up. Last 80 lines of demo-up-3node.log:" >&2
  tail -80 "${ROOT_DIR}/logs/demo-up-3node.log" >&2
  exit 1
fi

QUESTION='Was the Bitcoin genesis block mined on January 3, 2009?'
echo "[smoke3] injecting question via UI /api/inject..."
INJECT_RESP=$("${CURL_BIN}" -fsS -X POST http://127.0.0.1:3000/api/inject \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"${QUESTION}\",\"outcomes\":[0,1],\"deadlineSecs\":180}" 2>&1)
echo "[smoke3]   response: ${INJECT_RESP}"

QID=$(echo "${INJECT_RESP}" | grep -oE '"questionId":"[a-f0-9]{64}"' | head -1 | sed 's/.*"\([a-f0-9]\{64\}\)".*/\1/')
if [[ -z "${QID}" ]]; then
  echo "[smoke3] ERROR: could not parse questionId" >&2
  exit 1
fi
echo "[smoke3]   question id: ${QID}"

echo "[smoke3] polling /api/state for 3 settlers + consensus + on-chain..."
SUCCESS=0
STATE=""
for i in $(seq 1 120); do
  STATE=$("${CURL_BIN}" -fsS http://127.0.0.1:3000/api/state 2>/dev/null)
  if [[ -z "${STATE}" ]]; then sleep 1; continue; fi

  CHECK=$(echo "${STATE}" | "${PY}" -c "
import json, sys
s = json.load(sys.stdin)
settlers = s.get('settlers', [])
onchain = s.get('onchain') or {}
consensus = s.get('consensus') or {}
voted = sum(1 for x in settlers if x.get('votedOutcome') is not None)
ok = (
    len(settlers) >= 3
    and voted >= 3
    and consensus.get('outcome') is not None
    and str(onchain.get('postedTxHash', '')).startswith('0x')
    and (onchain.get('proof') or {}).get('status') == 'verified'
)
print('ok' if ok else 'wait')
" | tr -d '\r')
  if [[ "${CHECK}" == "ok" ]]; then
    echo "[smoke3] ok consensus + on-chain visible after ${i}s"
    SUCCESS=1
    break
  fi
  sleep 1
done

if [[ "${SUCCESS}" -ne 1 ]]; then
  echo "[smoke3] ERROR: 3-settler consensus/on-chain proof never appeared in /api/state" >&2
  echo "--- final /api/state ---" >&2
  echo "${STATE}" >&2
  echo "--- settler tails ---" >&2
  tail -20 "${ROOT_DIR}/logs/settler-a.log" 2>/dev/null >&2 || true
  tail -20 "${ROOT_DIR}/logs/settler-b.log" 2>/dev/null >&2 || true
  tail -20 "${ROOT_DIR}/logs/settler-c.log" 2>/dev/null >&2 || true
  exit 1
fi

echo
echo "=== final 3-node state ==="
echo "${STATE}" | "${PY}" -c "
import sys, json
s = json.load(sys.stdin)
c = s.get('consensus') or {}
o = s.get('onchain') or {}
p = o.get('proof') or {}
print(f\"  prompt:           {c.get('prompt','-')}\")
print(f\"  question_id:      {c.get('questionId','-')[:16]}...\")
print(f\"  outcome:          {c.get('outcome')}\")
print(f\"  quorum:           {c.get('quorumSize')}\")
print(f\"  weighted_score:   {c.get('weightedScore')}\")
print(f\"  registry:         {o.get('registryAddress','-')}\")
print(f\"  tx_hash:          {o.get('postedTxHash','-')}\")
print(f\"  proof:            {p.get('status','-')}\")
print(f\"  settlers online:  {sum(1 for x in s.get('settlers', []) if x.get('online'))} / {len(s.get('settlers', []))}\")
print(f\"  settlers voted:   {sum(1 for x in s.get('settlers', []) if x.get('votedOutcome') is not None)} / {len(s.get('settlers', []))}\")
"

REG_ADDR=$(echo "${STATE}" | "${PY}" -c "import json, sys; print(str((json.load(sys.stdin).get('onchain') or {}).get('registryAddress', '')).strip())" 2>/dev/null | tr -d '\r')
if [[ -z "${REG_ADDR}" ]]; then
  echo "[smoke3] ERROR: could not read registry address from /api/state" >&2
  exit 1
fi
VERIFY_RESP=$("${PY}" settler/tools/verify_settlement.py \
  --rpc-url http://127.0.0.1:8545 \
  --registry-address "${REG_ADDR}" \
  --question-id "${QID}" \
  --json 2>&1)
if ! echo "${VERIFY_RESP}" | grep -q '"status": "verified"'; then
  echo "[smoke3] ERROR: independent verifier rejected settlement proof" >&2
  echo "${VERIFY_RESP}" >&2
  exit 1
fi
echo "  independent_cli:  verified"
echo
echo "3-NODE DEMO SMOKE TEST OK"
