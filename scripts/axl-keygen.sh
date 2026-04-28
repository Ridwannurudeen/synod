#!/usr/bin/env bash
# Generate an ed25519 key pair for an AXL node identity.
#
# Usage: scripts/axl-keygen.sh <node-name>
# Writes: keys/<node-name>.pem
#
# Notes:
# - On macOS with LibreSSL openssl, ed25519 is not supported. Use Homebrew openssl:
#       /opt/homebrew/opt/openssl/bin/openssl genpkey -algorithm ed25519 -out keys/<n>.pem
# - On Linux/Git Bash with full OpenSSL, the standard `openssl` works.
# - AXL ships its own key derivation; this just produces the persistent identity file
#   that AXL expects via `PrivateKeyPath` in node-config.json.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <node-name>" >&2
  exit 1
fi

NODE_NAME="$1"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KEYS_DIR="${ROOT_DIR}/keys"
KEY_PATH="${KEYS_DIR}/${NODE_NAME}.pem"

mkdir -p "${KEYS_DIR}"

if [[ -f "${KEY_PATH}" ]]; then
  echo "key already exists: ${KEY_PATH}"
  exit 0
fi

OPENSSL_BIN="${OPENSSL_BIN:-openssl}"
"${OPENSSL_BIN}" genpkey -algorithm ed25519 -out "${KEY_PATH}"
chmod 600 "${KEY_PATH}"

echo "generated: ${KEY_PATH}"
