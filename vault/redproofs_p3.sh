#!/usr/bin/env bash
# Phase 3 red proofs. Run: bash vault/redproofs_p3.sh   (demo.sh resets vault state by design)
cd "$(dirname "$0")/.." || exit 2
NODE="node --disable-warning=ExperimentalWarning"
fail=0
verdicts() { echo "$1" | sed 's/\x1b\[[0-9;]*m//g' | grep -oE '^VERDICT: (CLEAN|REFUSED \([A-Z]+\))'; }

# R9 — the demo isn't a one-off
o1=$(bash vault/demo.sh 2>&1); c1=$?; r1=$(wc -l < vault/receipts.jsonl 2>/dev/null | tr -d ' ')
o2=$(bash vault/demo.sh 2>&1); c2=$?; r2=$(wc -l < vault/receipts.jsonl 2>/dev/null | tr -d ' ')
v1=$(verdicts "$o1"); v2=$(verdicts "$o2")
if [ $c1 -eq 0 ] && [ $c2 -eq 0 ] && [ "$v1" = "$v2" ] && [ "$(echo "$v1" | tail -1)" = "VERDICT: REFUSED (DRIFTED)" ] && [ "${r1:-0}" -ge 1 ] && [ "$r1" = "$r2" ]; then
  echo "R9 PASS (2 runs, identical verdicts [$(echo $v1 | tr '\n' ' ')], $r1 receipt each)"
else echo "R9 FAIL (exit $c1/$c2, receipts $r1/$r2)"; echo "$v1"; echo "--"; echo "$v2"; fail=1; fi

# R10 — the real adapter can't silently change shape
out=$($NODE vault/conformance.ts); rc=$?
if [ $rc -eq 0 ] && echo "$out" | grep -q "^MATCH"; then echo "R10 PASS"; echo "$out" | sed 's/^/     /'; else echo "R10 FAIL"; echo "$out"; fail=1; fi

# R11 — the demo fits a judging slot
t=$( { TIMEFORMAT=%R; time bash vault/demo.sh >/dev/null 2>&1; } 2>&1 )
if awk "BEGIN{exit !($t < 180)}"; then echo "R11 PASS (demo wall time ${t}s < 180s)"; else echo "R11 FAIL (${t}s)"; fail=1; fi

# R12 — the counter is real, not hardcoded
out=$($NODE vault/scenario.ts --clean); rc=$?
ev=$($NODE vault/evidence.ts); counter=$(echo "$ev" | grep '^counter:')
K=$(echo "$counter" | sed -E 's/counter: ([0-9]+) clean.*/\1/'); F=$(echo "$counter" | sed -E 's/.*· ([0-9]+) false.*/\1/')
C=$(grep -c '"verdict":"CLEAN"' vault/runs.jsonl)
if [ $rc -eq 0 ] && [ "$K" -ge 1 ] && [ "$F" = 0 ] && [ "$K" = "$C" ]; then
  echo "R12 PASS ($counter; runs.jsonl CLEAN count = $C)"
else echo "R12 FAIL (rc=$rc K=$K F=$F C=$C)"; echo "$ev"; fail=1; fi

# R17 — the agent can't smuggle a hallucination past the gate
# (a) checker: a fabricated pin, an uncited claim, a URL and an invented number are all dropped before a draft
chk=$($NODE --input-type=module -e '
const { checkClaims } = await import("./vault/agent.ts");
const basis = [{ pin_id: "aaaa11112222", fact: "price of Sony is 298.00 USD" }];
const r = checkClaims("Sony sells at 298.00 USD [pin:aaaa11112222]. Bose is cheapest at 199.00 USD [pin:deadbeef0000]. Prices are falling. See https://x.y [pin:aaaa11112222]. Sony is 250.00 USD [pin:aaaa11112222].", basis);
console.log(r.kept.length, r.dropped.length);')
# (b) end to end: hand-edit a shipped report to cite a nonexistent pin; verify says MISSING, gate refuses, nothing ships
$NODE vault/simulate.ts --clean >/dev/null
tmp=$(mktemp -t forged.XXXXXX); sed '0,/\[pin:[0-9a-f]*\]/s//[pin:deadbeef0000]/' vault/report.md > "$tmp"
grep -q 'deadbeef0000' "$tmp" || sed -i '' '1,/\[pin:[0-9a-f]*\]/s/\[pin:[0-9a-f]*\]/[pin:deadbeef0000]/' "$tmp"
vout=$($NODE vault/verify_pins.ts --report "$tmp"); vrc=$?
f0=$(shasum -a 256 vault/report.md | cut -d' ' -f1)
sout=$($NODE vault/ship.ts --from "$tmp"); src=$?
f1=$(shasum -a 256 vault/report.md | cut -d' ' -f1); rm -f "$tmp"
if [ "$chk" = "1 4" ] && [ $vrc -ne 0 ] && echo "$vout" | grep -q "^MISSING deadbeef0000" && [ $src -ne 0 ] && echo "$sout" | grep -q "REFUSED" && [ "$f0" = "$f1" ]; then
  echo "R17 PASS (checker kept 1/5 claims; forged [pin:deadbeef0000] -> MISSING + REFUSED; report.md unchanged)"
else echo "R17 FAIL (chk=$chk verify=$vrc ship=$src)"; echo "$vout" | tail -3; echo "$sout" | head -3; fail=1; fi

# R16 — the Tinybird read path can't disagree with the local truth; offline still works
if [ -f vault/.env ]; then set -a; . vault/.env; set +a; fi
nums() { echo "$1" | grep -E '^(north star|counter):' | grep -oE '[0-9]+' | tr '\n' ' '; }
on=$($NODE vault/evidence.ts); onrc=$?
off=$(TINYBIRD_HOST=http://127.0.0.1:9 $NODE vault/evidence.ts); offrc=$?
if [ -z "$TINYBIRD_TOKEN" ]; then echo "R16 SKIP (no TINYBIRD_TOKEN)"
elif [ $onrc -eq 0 ] && [ $offrc -eq 0 ] && echo "$on" | grep -q "Tinybird pipe vault_evidence — matches local" \
   && echo "$off" | grep -q "evidence source: local (Tinybird offline" && [ "$(nums "$on")" = "$(nums "$off")" ]; then
  echo "R16 PASS (pipe == local: [$(nums "$on")]; offline exit 0 with identical counts)"
else echo "R16 FAIL (on=$onrc off=$offrc)"; echo "$on"; echo "$off"; fail=1; fi

# R15 — the Agent Skill describes the built vault, not a fantasy
VAULT_AGENT=off $NODE vault/simulate.ts --clean >/dev/null      # mock vault: content-addressed pins are stable
sv=$($NODE vault/verify_pins.ts --report vault/skill/SKILL.md); svrc=$?
missing_files=$(grep -oE '[a-z_]+\.(ts|db|jsonl|md)' vault/skill/SKILL.md | sort -u | grep -v '^SKILL.md$' | while read f; do [ -e "vault/$f" ] || echo "$f"; done)
missing_fields=$(for k in refused_at reason drifted_facts error pin_hashes basis_window; do tail -1 vault/receipts.jsonl | grep -q "\"$k\"" || echo "$k"; done)
head -3 vault/skill/SKILL.md | grep -q '^name: ' && fm=ok || fm=no
if [ $svrc -eq 0 ] && [ -z "$missing_files" ] && [ -z "$missing_fields" ] && [ "$fm" = ok ]; then
  echo "R15 PASS (skill pins: $(echo "$sv" | tail -1); every named file exists; receipt fields match)"
else echo "R15 FAIL (verify=$svrc files=[$missing_files] fields=[$missing_fields] frontmatter=$fm)"; echo "$sv"; fail=1; fi

exit $fail
