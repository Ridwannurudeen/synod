#!/usr/bin/env bash
# Smoke-test the full demo stack non-interactively.
#
# Brings up demo-up.sh in the background, waits for the UI to be ready,
# drives the /api/inject + /api/state endpoints with curl, asserts both
# the off-chain consensus and the on-chain settlement appear, then kills
# everything. Pure validation — no human-driven UI clicks needed.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

mkdir -p logs

cleanup() {
  echo
  echo "[smoke] tearing down..."
  pkill -f demo-up.sh >/dev/null 2>&1 || true
  pkill -f run_settler.py >/dev/null 2>&1 || true
  taskkill //F //IM axl-node.exe >/dev/null 2>&1 || true
  taskkill //F //IM anvil.exe >/dev/null 2>&1 || true
  taskkill //F //IM node.exe >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# Boot the orchestrator
echo "[smoke] starting demo-up.sh..."
bash tools/demo-up.sh > "${ROOT_DIR}/logs/demo-up.log" 2>&1 &
DEMO_PID=$!

# Wait until the UI dev server answers /api/state (which only succeeds once
# settlers are up + AXL is reachable + everything is wired).
echo -n "[smoke] waiting for UI"
UI_READY=0
for _ in $(seq 1 120); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/api/state 2>/dev/null; then
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
INJECT_RESP=$(curl -fsS -X POST http://127.0.0.1:3000/api/inject \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"${QUESTION}\",\"outcomes\":[0,1],\"deadlineSecs\":180}" 2>&1)
echo "[smoke]   response: ${INJECT_RESP}"

QID=$(echo "${INJECT_RESP}" | grep -oE '"questionId":"[a-f0-9]{64}"' | head -1 | sed 's/.*"\([a-f0-9]\{64\}\)".*/\1/')
if [[ -z "${QID}" ]]; then
  echo "[smoke] ERROR: could not parse questionId" >&2
  exit 1
fi
echo "[smoke]   question id: ${QID}"

# Poll /api/state for both off-chain consensus AND on-chain tx
echo "[smoke] polling /api/state for consensus + on-chain..."
SUCCESS=0
for i in $(seq 1 90); do
  STATE=$(curl -fsS http://127.0.0.1:3000/api/state 2>/dev/null)
  if [[ -z "${STATE}" ]]; then sleep 1; continue; fi

  HAS_CONSENSUS=$(echo "${STATE}" | grep -c '"outcome":')
  HAS_TX=$(echo "${STATE}" | grep -c '"postedTxHash":"0x')
  if [[ "${HAS_CONSENSUS}" -ge 1 && "${HAS_TX}" -ge 1 ]]; then
    echo "[smoke] ✓ consensus + on-chain visible after ${i}s"
    SUCCESS=1
    break
  fi
  sleep 1
done

if [[ "${SUCCESS}" -ne 1 ]]; then
  echo "[smoke] ERROR: consensus or on-chain never appeared in /api/state" >&2
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
echo "${STATE}" | python -c "
import sys, json
s = json.load(sys.stdin)
c = s.get('consensus') or {}
o = s.get('onchain') or {}
print(f\"  prompt:           {c.get('prompt','-')}\")
print(f\"  question_id:      {c.get('questionId','-')[:16]}...\")
print(f\"  outcome:          {c.get('outcome')}\")
print(f\"  quorum:           {c.get('quorumSize')}\")
print(f\"  weighted_score:   {c.get('weightedScore')}\")
print(f\"  registry:         {o.get('registryAddress','-')}\")
print(f\"  chain_id:         {o.get('chainId','-')}\")
print(f\"  tx_hash:          {o.get('postedTxHash','-')}\")
print(f\"  posted_by:        {o.get('postedBy','-')}\")
print(f\"  settlers online:  {sum(1 for x in s.get('settlers', []) if x.get('online'))} / {len(s.get('settlers', []))}\")
"
echo
echo "DEMO SMOKE TEST OK"
