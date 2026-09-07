#!/usr/bin/env bash
set -Eeuo pipefail

api_url="${1:-https://api.seraquefake.pedrooreis.me}"
frontend_url="${2:-https://seraquefake.pedrooreis.me}"

curl --fail --silent --show-error "$api_url/api/healthz"
echo
curl --fail --silent --show-error --head "$frontend_url" | head -n 1
