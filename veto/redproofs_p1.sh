#!/usr/bin/env bash
# Phase 1 red proofs. Run: bash veto/redproofs_p1.sh
cd "$(dirname "$0")/.." || exit 2
NODE="node --disable-warning=ExperimentalWarning"
fail=0
$NODE veto/ship.ts >/dev/null || { echo "setup: gated ship failed"; exit 2; }
$NODE veto/verify_pins.ts >/dev/null || { echo "setup: baseline verify not clean"; exit 2; }

# R1 — the seam is real
out=$(grep -rn "MockAdapter" veto/ --include=*.ts --exclude-dir=node_modules | grep -v adapters.ts | grep -v redproofs)
if [ -z "$out" ]; then echo "R1 PASS (no MockAdapter outside adapters.ts)"; else echo "R1 FAIL"; echo "$out"; fail=1; fi

# R2 — pins are content-addressed: flip one fact_text char, verify must say MISSING + exit non-zero
pid=$(grep -o '\[pin:[0-9a-f]*\]' veto/report.md | head -1 | sed 's/\[pin:\(.*\)\]/\1/')
before=$(shasum -a 256 veto/pins.db | cut -d' ' -f1)
tmp=$(mktemp -t pins.XXXXXX); cp veto/pins.db "$tmp"
sqlite3 "$tmp" "UPDATE pins SET fact_text = CASE WHEN substr(fact_text,1,1)='X' THEN 'Y' ELSE 'X' END || substr(fact_text,2) WHERE pin_id='$pid';"
vout=$($NODE veto/verify_pins.ts --db "$tmp"); vrc=$?
rm -f "$tmp"
after=$(shasum -a 256 veto/pins.db | cut -d' ' -f1)
if [ "$before" = "$after" ] && [ $vrc -ne 0 ] && echo "$vout" | grep -q "^MISSING $pid" && ! echo "$vout" | grep -q "^OK *$pid"; then
  echo "R2 PASS (tampered pin $pid in temp copy -> MISSING, exit $vrc; real pins.db byte-identical)"
else echo "R2 FAIL (exit $vrc)"; echo "$vout"; fail=1; fi

# R3 — no bare URLs escape into the report
n=$(grep -c "http" veto/report.md)
if [ "$n" = "0" ]; then echo "R3 PASS (http count: $n)"; else echo "R3 FAIL (http count: $n)"; fail=1; fi

exit $fail
