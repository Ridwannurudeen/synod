#!/usr/bin/env bash
# Smoke-test the full demo stack non-interactively.
#
# Brings up demo-up.sh in the background, waits for the UI to be ready,
# drives the /api/inject + /api/state endpoints with curl, asserts both
# the off-chain consensus and the on-chain settlement appear, then kills
# everything. Pure validation — no human-driven UI clicks needed.

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

cleanup() {
  echo
  echo "[smoke] tearing down..."
  pkill -f demo-up.sh >/dev/null 2>&1 || true
  pkill -f run_settler.py >/dev/null 2>&1 || true
  stop_stale_ui_dev
  taskkill //F //IM axl-node.exe >/dev/null 2>&1 || true
  taskkill //F //IM anvil.exe >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

stop_stale_ui_dev

# Boot the orchestrator
echo "[smoke] starting demo-up.sh..."
bash tools/demo-up.sh > "${ROOT_DIR}/logs/demo-up.log" 2>&1 &
DEMO_PID=$!

# Wait until the UI dev server answers /api/state (which only succeeds once
# settlers are up + AXL is reachable + everything is wired).
echo -n "[smoke] waiting for UI"
UI_READY=0
for _ in $(seq 1 120); do
  if "${CURL_BIN}" -fsS http://127.0.0.1:3000/api/state >/dev/null 2>&1; then
    UI_READY=1; echo " ✓"; break
  fi
  echo -n "."
  sleep 1
done

if [[ "${UI_READY}" -ne 1 ]]; then
  echo
  echo "[smoke] ERROR: UI never came up. Last 50 lines of demo-up.log:" >&2
  tail -50 "${ROOT_DIR}/logs/demo-up.log" >&2
  exit 1
fi

# Inject a question via the UI's API
QUESTION='Was the Bitcoin genesis block mined on January 3, 2009?'
echo "[smoke] injecting question via UI /api/inject..."
INJECT_RESP=$("${CURL_BIN}" -fsS -X POST http://127.0.0.1:3000/api/inject \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"${QUESTION}\",\"outcomes\":[0,1],\"deadlineSecs\":180}" 2>&1)
echo "[smoke]   response: ${INJECT_RESP}"

QID=$(echo "${INJECT_RESP}" | grep -oE '"questionId":"[a-f0-9]{64}"' | head -1 | sed 's/.*"\([a-f0-9]\{64\}\)".*/\1/')
if [[ -z "${QID}" ]]; then
  echo "[smoke] ERROR: could not parse questionId" >&2
  exit 1
fi
echo "[smoke]   question id: ${QID}"

# Poll /api/state for off-chain consensus, on-chain tx, and verified proof
echo "[smoke] polling /api/state for consensus + on-chain..."
SUCCESS=0
for i in $(seq 1 90); do
  STATE=$("${CURL_BIN}" -fsS http://127.0.0.1:3000/api/state 2>/dev/null)
  if [[ -z "${STATE}" ]]; then sleep 1; continue; fi

  HAS_CONSENSUS=$(echo "${STATE}" | grep -c '"outcome":')
  HAS_TX=$(echo "${STATE}" | grep -c '"postedTxHash":"0x')
  HAS_VERIFIED_PROOF=$(echo "${STATE}" | grep -c '"status":"verified"')
  if [[ "${HAS_CONSENSUS}" -ge 1 && "${HAS_TX}" -ge 1 && "${HAS_VERIFIED_PROOF}" -ge 1 ]]; then
    echo "[smoke] ✓ consensus + on-chain visible after ${i}s"
    SUCCESS=1
    break
  fi
  sleep 1
done

if [[ "${SUCCESS}" -ne 1 ]]; then
  echo "[smoke] ERROR: consensus, on-chain tx, or verified proof never appeared in /api/state" >&2
  echo "--- final /api/state ---" >&2
  echo "${STATE}" >&2
  echo "--- settler-a tail ---" >&2
  tail -30 "${ROOT_DIR}/logs/settler-a.log" 2>/dev/null >&2 || true
  echo "--- settler-b tail ---" >&2
  tail -30 "${ROOT_DIR}/logs/settler-b.log" 2>/dev/null >&2 || true
  exit 1
fi

# Pretty-print the relevant fields
echo
echo "=== final state ==="
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
print(f\"  chain_id:         {o.get('chainId','-')}\")
print(f\"  tx_hash:          {o.get('postedTxHash','-')}\")
print(f\"  posted_by:        {o.get('postedBy','-')}\")
print(f\"  proof:            {p.get('status','-')}\")
print(f\"  settlers online:  {sum(1 for x in s.get('settlers', []) if x.get('online'))} / {len(s.get('settlers', []))}\")
"

REG_ADDR=$(grep -oE "registry: 0x[a-fA-F0-9]{40}" "${ROOT_DIR}/logs/demo-up.log" | tail -1 | awk '{print $2}')
if [[ -z "${REG_ADDR}" ]]; then
  echo "[smoke] ERROR: could not parse registry address from demo-up.log" >&2
  exit 1
fi
VERIFY_RESP=$("${PY}" settler/tools/verify_settlement.py \
  --rpc-url http://127.0.0.1:8545 \
  --registry-address "${REG_ADDR}" \
  --question-id "${QID}" \
  --json 2>&1)
if ! echo "${VERIFY_RESP}" | grep -q '"status": "verified"'; then
  echo "[smoke] ERROR: independent verifier rejected settlement proof" >&2
  echo "${VERIFY_RESP}" >&2
  exit 1
fi
echo "  independent_cli:  verified"
echo
echo "DEMO SMOKE TEST OK"
