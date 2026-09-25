#!/usr/bin/env bash
# Phase 2 red proofs. Run: bash veto/redproofs_p2.sh
cd "$(dirname "$0")/.." || exit 2
NODE="node --disable-warning=ExperimentalWarning"
R=veto/receipts.jsonl; REP=veto/report.md
fail=0
lines() { [ -f "$R" ] && wc -l < "$R" | tr -d ' ' || echo 0; }
fp() { [ -f "$REP" ] && echo "$(shasum -a 256 "$REP" | cut -d' ' -f1)-$(stat -f %m "$REP")" || echo absent; }
rm -f veto/receipts.jsonl veto/runs.jsonl veto/ships.jsonl   # this run's artifacts only (kept as evidence below)
$NODE veto/simulate.ts --clean >/dev/null || { echo "setup: clean baseline failed"; exit 2; }

# R4 — drift cannot slip through
n0=$(lines); out=$($NODE veto/simulate.ts --drift); rc=$?
last=$(tail -1 "$R" 2>/dev/null)
ok=$(echo "$last" | $NODE -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(r.reason==="DRIFTED"&&r.drifted_facts.length>0&&r.drifted_facts.every(d=>d.old_hash!==d.new_hash)?"y":"n")' 2>/dev/null)
if [ $rc -ne 0 ] && echo "$out" | grep -q "^VERDICT: REFUSED (DRIFTED)" && [ "$(lines)" -eq $((n0+1)) ] && [ "$ok" = y ]; then
  echo "R4 PASS (REFUSED, receipt +1, old_hash != new_hash)"; else echo "R4 FAIL"; echo "$out"; fail=1; fi

# R5 — outage cannot cause a stale ship
n0=$(lines); f0=$(fp); sleep 1; out=$($NODE veto/simulate.ts --outage); rc=$?; f1=$(fp)
if [ $rc -ne 0 ] && echo "$out" | grep -q "^VERDICT: REFUSED (UNREACHABLE)" && [ "$f0" = "$f1" ] && [ "$(lines)" -eq $((n0+1)) ]; then
  echo "R5 PASS (REFUSED fail-closed, report.md untouched, receipt +1)"; else echo "R5 FAIL (report $f0 -> $f1)"; echo "$out"; fail=1; fi

R5_BEFORE="$f0"; R5_AFTER="$f1"

# R6 — the gate doesn't cry wolf
out=$($NODE veto/simulate.ts --clean); rc=$?
if [ $rc -eq 0 ] && echo "$out" | grep -q "^VERDICT: CLEAN"; then echo "R6 PASS ($out)"; else echo "R6 FAIL"; echo "$out"; fail=1; fi

# R7 — the safety check doesn't depend on a model
out=$(grep -rniE "openai|anthropic|llm|client\." veto/gate.ts)
if [ -z "$out" ]; then echo "R7 PASS (gate.ts has no model/client references)"; else echo "R7 FAIL"; echo "$out"; fail=1; fi

# R8 — receipts are checkable: hashes match pins.db, refused_at inside the run window
start=$($NODE -e 'console.log(new Date().toISOString())')
$NODE veto/simulate.ts --drift >/dev/null
end=$($NODE -e 'console.log(new Date().toISOString())')
known=$(mktemp -t hashes.XXXXXX); sqlite3 veto/pins.db "SELECT sha256 FROM pins" > "$known"
res=$(tail -1 "$R" | $NODE -e '
const r=JSON.parse(require("fs").readFileSync(0,"utf8"));
const known=new Set(require("fs").readFileSync(process.argv[1],"utf8").split("\n"));
const miss=r.pin_hashes.filter(h=>!known.has(h));
const inWin=r.refused_at>=process.argv[2]&&r.refused_at<=process.argv[3];
console.log(`${r.pin_hashes.length} ${miss.length} ${inWin}`)' "$known" "$start" "$end")
rm -f "$known"; read total missing inwin <<< "$res"
if [ "${total:-0}" -gt 0 ] && [ "$missing" = 0 ] && [ "$inwin" = true ]; then
  echo "R8 PASS ($total/$total receipt hashes found in pins.db; refused_at in [$start, $end])"
else echo "R8 FAIL (total=$total missing=$missing in_window=$inwin)"; fail=1; fi

# G1 — report.ts alone cannot ship: it writes a draft, never report.md
f0=$(fp); sleep 1; $NODE veto/report.ts >/dev/null; rc=$?; f1=$(fp)
if [ $rc -eq 0 ] && [ "$f0" = "$f1" ] && [ -f veto/report.draft.md ]; then echo "G1 PASS (report.ts wrote draft only; report.md untouched)"
else echo "G1 FAIL (rc=$rc report $f0 -> $f1)"; fail=1; fi

# G2 — drift + re-base: refuse the old basis with a receipt, re-pin, disclose, ship; shipped report verifies
n0=$(lines); out=$($NODE veto/simulate.ts --drift --rebase); rc=$?
vout=$($NODE veto/verify_pins.ts); vrc=$?
if [ $rc -eq 0 ] && echo "$out" | grep -q "REFUSED (DRIFTED)" && echo "$out" | grep -q "shipped re-based" \
   && [ "$(lines)" -eq $((n0+1)) ] && grep -q '\[was-pin:' "$REP" && [ $vrc -eq 0 ] && [ "$(grep -c http "$REP")" = 0 ]; then
  echo "G2 PASS (refused + receipt, re-based, drift disclosed, $(echo "$vout" | tail -1))"
else echo "G2 FAIL (rc=$rc verify=$vrc)"; echo "$out"; fail=1; fi
$NODE veto/simulate.ts --clean >/dev/null   # leave a clean shipped report behind

# G3: keep this mock run's artifacts as committed evidence (R4 drift, R5 outage, R6 clean, verify output)
EV="evidence/mock-run-$(date -u +%F)"; mkdir -p "$EV"
cp veto/receipts.jsonl "$EV/receipts.jsonl"; cp veto/runs.jsonl "$EV/runs.jsonl"; [ -f veto/ships.jsonl ] && cp veto/ships.jsonl "$EV/ships.jsonl"
$NODE veto/verify_pins.ts > "$EV/verify_pins.txt" 2>&1
printf 'R5 report.md before: %s\nR5 report.md after:  %s\n(format: sha256-mtime; identical = untouched)\n' "$R5_BEFORE" "$R5_AFTER" > "$EV/r5_report_sha256.txt"

exit $fail
