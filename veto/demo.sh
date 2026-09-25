#!/usr/bin/env bash
# One command, full arc: fetch → pins → report → clean night ships → villain night REFUSED + receipt → counts.
#   bash veto/demo.sh          mock adapter
#   bash veto/demo.sh --real   Nimble MCP (needs NIMBLE_API_KEY + veto/pages.real.txt)
cd "$(dirname "$0")" || exit 2
NODE="node --disable-warning=ExperimentalWarning"
[ -f .env ] && { set -a; . ./.env; set +a; }   # optional: NIMBLE_API_KEY=... (gitignored)
# On-device Liquid: make sure the local model server is up (models stay on this machine).
if [ -n "$VETO_LIQUID_URL" ] && ! curl -s -m 2 -o /dev/null "${VETO_LIQUID_URL%%/v1/*}/api/tags"; then
  (nohup ollama serve >/dev/null 2>&1 &); sleep 2   # default parallelism: two 1.2B models on 16 GB
fi
# Warm both Liquid models into memory before the clock starts (a cold load can exceed the per-call timeout).
if [ -n "$VETO_LIQUID_URL" ]; then
  for m in "${VETO_EXTRACT_MODEL:-hf.co/LiquidAI/LFM2-1.2B-Extract-GGUF:Q4_K_M}" "${VETO_AGENT_MODEL:-hf.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF:Q4_K_M}"; do
    curl -s -m 60 -o /dev/null "${VETO_LIQUID_URL%%/v1/*}/api/generate" -d "{\"model\":\"$m\",\"prompt\":\"ok\",\"stream\":false,\"keep_alive\":\"30m\",\"options\":{\"num_predict\":1}}" &
  done; wait
fi
if [ "$1" = "--real" ]; then
  export VETO_ADAPTER=nimble VETO_PAGES=pages.real.txt
  # preflight before reset: never wipe the veto for a run that cannot start
  [ -n "$NIMBLE_API_KEY" ] || { echo "demo --real: NIMBLE_API_KEY not set (Nimble → Account Settings → API Keys). Veto untouched."; exit 3; }
  grep -qv '^#' pages.real.txt || { echo "demo --real: pages.real.txt has no URLs. Veto untouched."; exit 3; }
fi
rm -f pins.db receipts.jsonl runs.jsonl ships.jsonl mcp-trace.jsonl plan.json report.md report.draft.md   # deterministic: counts never accumulate

bar() { printf '\n\033[1m━━ %s ━━\033[0m\n' "$1"; }
bar "PINNED EVIDENCE VAULT — adapter: ${VETO_ADAPTER:-mock}"
if [ "$2" = "--night2" ] || [ "$1" = "--night2" ]; then c=0; else   # --night2: run only the villain night (fits a 3-min slot live)
bar "Night 1 — a competitor page goes dark at 18:00 (simulated); no price injected"
$NODE scenario.ts --clean --rebase --lose-page; c=$?
# Mock is deterministic: a clean-night refusal is a bug. Live: it is the real world moving — report it and continue.
[ $c -ne 0 ] && [ "${VETO_ADAPTER:-mock}" = mock ] && { echo "demo: clean night failed to ship"; exit 1; }
fi
bar "Night 2 — the villain"
$NODE scenario.ts --rebase; rc=$?
bar "Evidence"
$NODE evidence.ts
echo; echo "The brief cited six cases. None of them existed. This report cites pins — when they moved, it refused, re-planned, and shipped the truth."
[ $rc -eq 0 ] && exit 0 || exit 1
