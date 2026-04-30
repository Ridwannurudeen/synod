#!/usr/bin/env bash
# One-shot health check + demo recording preflight.
# Run before recording the master video — verifies every demo lever is live,
# warms caches, and surfaces any blockers (Settler D unfunded, judgment-mint
# blocked on gas, etc).
#
# Usage:  bash scripts/demo_preflight.sh
# Run from anywhere (uses absolute SSH targets).

set -u

BLUE="\033[34m"; GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; RESET="\033[0m"

ok()    { echo -e "  ${GREEN}✓${RESET} $1"; }
warn()  { echo -e "  ${YELLOW}!${RESET} $1"; }
fail()  { echo -e "  ${RED}✗${RESET} $1"; }
hd()    { echo; echo -e "${BLUE}== $1 ==${RESET}"; }

hd "1. Public surface"

for path in / /gallery /network /verify /api/ens /api/network /api/stats /api/gallery; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://synod.gudman.xyz$path")
  if [[ "$code" == "200" ]]; then ok "GET $path → 200"
  else fail "GET $path → $code"; fi
done

hd "2. ENS load-bearing"

ENS_SOURCE=$(curl -s https://synod.gudman.xyz/api/ens | grep -oE '"source":"[^"]*"' | head -1)
if [[ "$ENS_SOURCE" == '"source":"ens"' ]]; then
  ok "/api/ens reports source: ens"
else
  fail "/api/ens not bootstrapping from ENS — got $ENS_SOURCE"
fi

CONFIG_SRC=$(curl -s https://synod.gudman.xyz/api/network | grep -oE '"configSource":"[^"]*"' | head -1)
if [[ "$CONFIG_SRC" == '"configSource":"ens"' ]]; then
  ok "/api/network configSource: ens"
else
  fail "/api/network not loading registry from ENS — got $CONFIG_SRC"
fi

hd "3. Settler infrastructure"

SETTLERS=$(ssh root@75.119.153.252 'for s in a b c; do echo -n "$(systemctl is-active synod-settler-$s),"; done; echo' 2>/dev/null)
ACTIVE=$(echo "$SETTLERS" | grep -o 'active' | wc -l | tr -d ' ')
if [[ "$ACTIVE" -ge 3 ]]; then
  ok "Settlers a,b,c all active on Contabo"
else
  fail "Some settler services down (Contabo): $SETTLERS"
fi

D_STATE=$(ssh root@38.49.212.102 'systemctl is-active synod-axl-d; systemctl is-active synod-settler-d' 2>/dev/null)
if echo "$D_STATE" | head -1 | grep -q "^active$"; then
  ok "Settler D AXL daemon active (Servarica)"
else
  warn "Settler D AXL daemon NOT active — check 'ssh root@38.49.212.102 systemctl status synod-axl-d'"
fi
if echo "$D_STATE" | tail -1 | grep -q "^active$"; then
  ok "Settler D agent service active"
else
  warn "Settler D AGENT service NOT active — needs Gensyn L2 funding + on-chain registration"
fi

hd "4. Cross-machine mesh"

A_PEERS=$(ssh root@75.119.153.252 'curl -s http://127.0.0.1:9002/topology' 2>/dev/null | grep -oE 'tls://38\.49\.212\.102:[0-9]+')
if [[ -n "$A_PEERS" ]]; then
  ok "Contabo settler-A sees Servarica D as peer ($A_PEERS)"
else
  fail "Contabo→Servarica AXL link DOWN — judges won't see cross-machine"
fi

D_PEERS=$(ssh root@38.49.212.102 'curl -s http://127.0.0.1:9202/topology' 2>/dev/null | grep -oE 'tls://75\.119\.153\.252:[0-9]+')
if [[ -n "$D_PEERS" ]]; then
  ok "Servarica D sees Contabo A as peer ($D_PEERS)"
else
  fail "Servarica→Contabo AXL link DOWN"
fi

hd "5. 0G Storage transcripts"

T_COUNT=$(ssh root@75.119.153.252 '/opt/synod-app/settler/.venv/bin/python -c "import json; print(len(json.load(open(\"/opt/synod-app/runtime/transcripts.json\"))))"' 2>/dev/null)
if [[ "$T_COUNT" -ge 5 ]]; then
  ok "$T_COUNT transcripts persisted to 0G Storage"
else
  warn "Only $T_COUNT transcripts on 0G — gallery will be sparse"
fi

# Sample-fetch one transcript via public indexer
SAMPLE=$(curl -s "https://synod.gudman.xyz/api/gallery" | grep -oE '"indexerUrl":"[^"]+"' | head -1 | sed 's/"indexerUrl":"//; s/"$//')
if [[ -n "$SAMPLE" ]]; then
  IND_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SAMPLE")
  if [[ "$IND_CODE" == "200" ]]; then
    ok "0G indexer GET reachable — $IND_CODE"
  else
    fail "0G indexer returned $IND_CODE — public retrieval BROKEN"
  fi
fi

hd "6. ENS judgment subnames"

J_COUNT=$(ssh root@75.119.153.252 '/opt/synod-app/settler/.venv/bin/python -c "
import json, os
p = \"/opt/synod-app/runtime/judgments.json\"
print(len(json.load(open(p))) if os.path.exists(p) else 0)
"' 2>/dev/null)
if [[ "$J_COUNT" -ge 3 ]]; then
  ok "$J_COUNT judgment subnames minted"
else
  warn "Only $J_COUNT judgment subnames minted — fund deployer + run mint_judgment.py for demo questions"
fi

DEPLOYER_BAL=$(ssh root@75.119.153.252 '/opt/synod-app/settler/.venv/bin/python -c "
from web3 import Web3
import json
w3 = Web3(Web3.HTTPProvider(\"https://ethereum-rpc.publicnode.com\"))
addr = json.load(open(\"/opt/synod-app/runtime/.ens-deployer.json\"))[\"address\"]
print(f\"{w3.eth.get_balance(addr)/1e18:.6f}\")
"' 2>/dev/null)
GAS=$(ssh root@75.119.153.252 '/opt/synod-app/settler/.venv/bin/python -c "
from web3 import Web3
print(f\"{Web3(Web3.HTTPProvider(\\\"https://ethereum-rpc.publicnode.com\\\")).eth.gas_price/1e9:.2f}\")
"' 2>/dev/null)
echo "    deployer 0xbEdBe31d…CFcf: $DEPLOYER_BAL ETH | gas: ${GAS} gwei"
MIN_NEEDED=$(ssh root@75.119.153.252 '/opt/synod-app/settler/.venv/bin/python -c "
from web3 import Web3
gp = Web3(Web3.HTTPProvider(\"https://ethereum-rpc.publicnode.com\")).eth.gas_price
print(f\"{(450000 * gp * 1.3)/1e18:.6f}\")
"' 2>/dev/null)
if (( $(echo "$DEPLOYER_BAL > $MIN_NEEDED" | bc -l 2>/dev/null || echo 0) )); then
  ok "deployer can mint at least 1 judgment subname (need $MIN_NEEDED ETH per mint)"
else
  warn "deployer too low for a mint — need $MIN_NEEDED ETH per mint, have $DEPLOYER_BAL"
fi

hd "7. Demo video URLs (preload these tabs)"

cat <<EOF
  Homepage          https://synod.gudman.xyz/
  Gallery           https://synod.gudman.xyz/gallery
  Network           https://synod.gudman.xyz/network
  Verify (sky q)    https://synod.gudman.xyz/verify?qid=35af5309e85eec3d448fd80701082ad6e5a68c53a8b212a168c7940e3f501c24
  ENS app           https://app.ens.domains/synodai.eth
  0G transcript     https://indexer-storage-testnet-turbo.0g.ai/file?root=0xa5875313932f92060b83f981b4a390e1380bbac3b322e362222593ffb4c76add

EOF

hd "8. Demo theater scenarios"

cat <<'EOF'
  S1 (45s) — ENS hot-swap        edit synodai.eth synod.registry → /network swings
  S2 (60s) — Judgment subname     submit question → mint live → "open in ENS app"
  S3 (30s) — Two machines, mesh   side-by-side terminals, public IPs
  S4 (40s) — Prompt injection     the sky question, transcript on 0G
  S5 (25s) — 0G transcript        click "fetch raw transcript →"

  Master cut: 2:30 total. See docs/DEMO_THEATER.md.
EOF

echo
hd "Preflight complete"
