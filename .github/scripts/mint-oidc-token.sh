#!/usr/bin/env bash
# Mint a fresh GitHub OIDC JWT into $ANTHROPIC_IDENTITY_TOKEN_FILE.
#
# The assertion is SINGLE USE. Anthropic burns the JWT's `jti` on the first
# token exchange and rejects any replay with reason `jti_reused` — visible in
# Console > Workload identity > Authentication events, but surfaced to the SDK
# only as a bare 401 whose message blames the federation rule. The SDK re-reads
# this file on every exchange (it is built for k8s projected tokens, which the
# kubelet rotates; a GitHub Actions JWT never rotates on its own), so a token
# minted once per job is replayed by the second process that needs one.
#
# Call this immediately before EVERY command that may talk to the Anthropic API
# — each process has its own credential cache and so performs its own exchange.
#
# Set OIDC_ECHO_CLAIMS=0 to suppress the claims line (for refresher loops).
set -euo pipefail

: "${ANTHROPIC_IDENTITY_TOKEN_FILE:?ANTHROPIC_IDENTITY_TOKEN_FILE is not set}"
: "${ACTIONS_ID_TOKEN_REQUEST_URL:?no OIDC request URL - does the job grant id-token: write?}"
: "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:?no OIDC request token - does the job grant id-token: write?}"

tmp="$ANTHROPIC_IDENTITY_TOKEN_FILE.tmp"

# --fail and pipefail are load-bearing. Without them curl exits 0 on an HTTP
# error and the pipeline's status comes from jq, so a failed fetch writes the
# string "null" and the run dies a minute later, inside the SDK, on a 401 that
# names the wrong cause. The SDK validates nothing beyond a size cap.
curl -fsS --retry 5 --retry-delay 2 --retry-all-errors \
  -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=https://api.anthropic.com" \
  | jq -er .value > "$tmp"

# Refuse to hand the SDK anything that is not a three-segment JWT.
awk -F. 'NF == 3 && length($1) && length($2) && length($3) { ok = 1 }
         END { exit !ok }' "$tmp" \
  || { echo "::error::OIDC fetch produced no usable JWT"; rm -f "$tmp"; exit 1; }

# Write-then-move, so a concurrent reader never sees a half-written JWT.
mv "$tmp" "$ANTHROPIC_IDENTITY_TOKEN_FILE"

# Echo the non-secret claims — never the token. These are the values the
# federation rule is matched against, so a real mismatch is diagnosable from
# the run log. Best-effort: a decode quirk must not fail the run.
if [ "${OIDC_ECHO_CLAIMS:-1}" != "0" ]; then
  jq -rR 'split(".")[1] | gsub("-";"+") | gsub("_";"/") | @base64d | fromjson
          | {sub, aud, repository, event_name, ref, exp}' \
    < "$ANTHROPIC_IDENTITY_TOKEN_FILE" || true
fi
