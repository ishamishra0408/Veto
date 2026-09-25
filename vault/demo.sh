#!/usr/bin/env bash
# One command, full arc: fetch → pins → report → clean night ships → villain night REFUSED + receipt → counts.
#   bash vault/demo.sh          mock adapter
#   bash vault/demo.sh --real   Nimble MCP (needs NIMBLE_API_KEY + vault/pages.real.txt)
cd "$(dirname "$0")" || exit 2
NODE="node --disable-warning=ExperimentalWarning"
[ -f .env ] && { set -a; . ./.env; set +a; }   # optional: NIMBLE_API_KEY=... (gitignored)
if [ "$1" = "--real" ]; then
  export VAULT_ADAPTER=nimble VAULT_PAGES=pages.real.txt
  # preflight before reset: never wipe the vault for a run that cannot start
  [ -n "$NIMBLE_API_KEY" ] || { echo "demo --real: NIMBLE_API_KEY not set (Nimble → Account Settings → API Keys). Vault untouched."; exit 3; }
  grep -qv '^#' pages.real.txt || { echo "demo --real: pages.real.txt has no URLs. Vault untouched."; exit 3; }
fi
rm -f pins.db receipts.jsonl runs.jsonl report.md report.draft.md   # deterministic: counts never accumulate

bar() { printf '\n\033[1m━━ %s ━━\033[0m\n' "$1"; }
bar "PINNED EVIDENCE VAULT — adapter: ${VAULT_ADAPTER:-mock}"
if [ "${VAULT_ADAPTER:-mock}" = mock ]; then bar "Night 1 — the world holds"; else bar "Night 1 — nothing injected: whatever moves is the real page"; fi
$NODE scenario.ts --clean; c=$?
# Mock is deterministic: a clean-night refusal is a bug. Live: it is the real world moving — report it and continue.
[ $c -ne 0 ] && [ "${VAULT_ADAPTER:-mock}" = mock ] && { echo "demo: clean night failed to ship"; exit 1; }
bar "Night 2 — the villain"
$NODE scenario.ts; rc=$?
bar "Evidence"
$NODE evidence.ts
echo; echo "The brief cited six cases. None of them existed. This report cites pins — and when they moved, it did not ship."
[ $rc -eq 2 ] && exit 0 || exit 1
