#!/usr/bin/env bash
# Phase 3 red proofs. Run: bash veto/redproofs_p3.sh   (demo.sh resets veto state by design)
cd "$(dirname "$0")/.." || exit 2
NODE="node --disable-warning=ExperimentalWarning"
fail=0
verdicts() { echo "$1" | sed 's/\x1b\[[0-9;]*m//g' | grep -oE '^VERDICT: (CLEAN|REFUSED \([A-Z]+\))'; }

# R9 — the demo isn't a one-off
o1=$(bash veto/demo.sh 2>&1); c1=$?; r1=$(wc -l < veto/receipts.jsonl 2>/dev/null | tr -d ' ')
o2=$(bash veto/demo.sh 2>&1); c2=$?; r2=$(wc -l < veto/receipts.jsonl 2>/dev/null | tr -d ' ')
v1=$(verdicts "$o1"); v2=$(verdicts "$o2")
if [ $c1 -eq 0 ] && [ $c2 -eq 0 ] && [ "$v1" = "$v2" ] && [ "$(echo "$v1" | tail -1)" = "VERDICT: REFUSED (DRIFTED)" ] && [ "${r1:-0}" -ge 1 ] && [ "$r1" = "$r2" ]; then
  echo "R9 PASS (2 runs, identical verdicts [$(echo $v1 | tr '\n' ' ')], $r1 receipt each)"
else echo "R9 FAIL (exit $c1/$c2, receipts $r1/$r2)"; echo "$v1"; echo "--"; echo "$v2"; fail=1; fi

# R10 — the real adapter can't silently change shape
out=$($NODE veto/conformance.ts); rc=$?
if [ $rc -eq 0 ] && echo "$out" | grep -q "^MATCH"; then echo "R10 PASS"; echo "$out" | sed 's/^/     /'; else echo "R10 FAIL"; echo "$out"; fail=1; fi

# R11 — the demo fits a judging slot
t=$( { TIMEFORMAT=%R; time bash veto/demo.sh >/dev/null 2>&1; } 2>&1 )
if awk "BEGIN{exit !($t < 180)}"; then echo "R11 PASS (demo wall time ${t}s < 180s)"; else echo "R11 FAIL (${t}s)"; fail=1; fi

# R12 — the counter is real, not hardcoded
out=$($NODE veto/scenario.ts --clean); rc=$?
ev=$($NODE veto/evidence.ts); counter=$(echo "$ev" | grep '^counter:')
K=$(echo "$counter" | sed -E 's/counter: ([0-9]+) clean.*/\1/'); F=$(echo "$counter" | sed -E 's/.*· ([0-9]+) false.*/\1/')
C=$(grep -c '"verdict":"CLEAN"' veto/runs.jsonl)
if [ $rc -eq 0 ] && [ "$K" -ge 1 ] && [ "$F" = 0 ] && [ "$K" = "$C" ]; then
  echo "R12 PASS ($counter; runs.jsonl CLEAN count = $C)"
else echo "R12 FAIL (rc=$rc K=$K F=$F C=$C)"; echo "$ev"; fail=1; fi

# R17 — the agent can't smuggle a hallucination past the gate
# (a) checker: a fabricated pin, an uncited claim, a URL and an invented number are all dropped before a draft
chk=$($NODE --input-type=module -e '
const { checkClaims } = await import("./veto/agent.ts");
const basis = [{ pin_id: "aaaa11112222", fact: "price of Sony is 298.00 USD" }];
const r = checkClaims("Sony sells at 298.00 USD [pin:aaaa11112222]. Bose is cheapest at 199.00 USD [pin:deadbeef0000]. Prices are falling. See https://x.y [pin:aaaa11112222]. Sony is 250.00 USD [pin:aaaa11112222].", basis);
console.log(r.kept.length, r.dropped.length);')
# (b) end to end: hand-edit a shipped report to cite a nonexistent pin; verify says MISSING, gate refuses, nothing ships
$NODE veto/simulate.ts --clean >/dev/null
tmp=$(mktemp -t forged.XXXXXX); sed '0,/\[pin:[0-9a-f]*\]/s//[pin:deadbeef0000]/' veto/report.md > "$tmp"
grep -q 'deadbeef0000' "$tmp" || sed -i '' '1,/\[pin:[0-9a-f]*\]/s/\[pin:[0-9a-f]*\]/[pin:deadbeef0000]/' "$tmp"
vout=$($NODE veto/verify_pins.ts --report "$tmp"); vrc=$?
f0=$(shasum -a 256 veto/report.md | cut -d' ' -f1)
sout=$($NODE veto/ship.ts --from "$tmp"); src=$?
f1=$(shasum -a 256 veto/report.md | cut -d' ' -f1); rm -f "$tmp"
if [ "$chk" = "1 4" ] && [ $vrc -ne 0 ] && echo "$vout" | grep -q "^MISSING deadbeef0000" && [ $src -ne 0 ] && echo "$sout" | grep -q "REFUSED" && [ "$f0" = "$f1" ]; then
  echo "R17 PASS (checker kept 1/5 claims; forged [pin:deadbeef0000] -> MISSING + REFUSED; report.md unchanged)"
else echo "R17 FAIL (chk=$chk verify=$vrc ship=$src)"; echo "$vout" | tail -3; echo "$sout" | head -3; fail=1; fi

# R16 — the Tinybird read path can't disagree with the local truth; offline still works
if [ -f veto/.env ]; then set -a; . veto/.env; set +a; fi
nums() { echo "$1" | grep -E '^(north star|counter):' | grep -oE '[0-9]+' | tr '\n' ' '; }
on=$($NODE veto/evidence.ts); onrc=$?
off=$(TINYBIRD_HOST=http://127.0.0.1:9 $NODE veto/evidence.ts); offrc=$?
if [ -z "$TINYBIRD_TOKEN" ]; then echo "R16 SKIP (no TINYBIRD_TOKEN)"
elif [ $onrc -eq 0 ] && [ $offrc -eq 0 ] && echo "$on" | grep -q "Tinybird pipe vault_evidence — matches local" \
   && echo "$off" | grep -q "evidence source: local (Tinybird offline" && [ "$(nums "$on")" = "$(nums "$off")" ]; then
  echo "R16 PASS (pipe == local: [$(nums "$on")]; offline exit 0 with identical counts)"
else echo "R16 FAIL (on=$onrc off=$offrc)"; echo "$on"; echo "$off"; fail=1; fi

# R15 — the Agent Skill describes the built veto, not a fantasy
VETO_AGENT=off $NODE veto/simulate.ts --clean >/dev/null      # mock veto: content-addressed pins are stable
sv=$($NODE veto/verify_pins.ts --report veto/skill/SKILL.md); svrc=$?
missing_files=$(grep -oE '[a-z_]+\.(ts|db|jsonl|md)' veto/skill/SKILL.md | sort -u | grep -v '^SKILL.md$' | while read f; do [ -e "veto/$f" ] || echo "$f"; done)
missing_fields=$(for k in refused_at reason drifted_facts error pin_hashes basis_window; do tail -1 veto/receipts.jsonl | grep -q "\"$k\"" || echo "$k"; done)
head -3 veto/skill/SKILL.md | grep -q '^name: ' && fm=ok || fm=no
if [ $svrc -eq 0 ] && [ -z "$missing_files" ] && [ -z "$missing_fields" ] && [ "$fm" = ok ]; then
  echo "R15 PASS (skill pins: $(echo "$sv" | tail -1); every named file exists; receipt fields match)"
else echo "R15 FAIL (verify=$svrc files=[$missing_files] fields=[$missing_fields] frontmatter=$fm)"; echo "$sv"; fail=1; fi

# R18 — L1: a fact two extractors disagree on is never pinned (stubbed extractor; no network)
r18=$(VETO_AGENT=off $NODE --input-type=module -e '
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const { FetchAdapter, getAdapter } = await import("./veto/adapters.ts");
const { buildReport } = await import("./veto/report.ts");
const { connect } = await import("./veto/pins.ts");
const base = getAdapter("mock");
class WithRaw extends FetchAdapter {
  name = "test"; last = new Map();
  async fetch(u) { const r = await base.fetch(u); this.last.set(u, r); return r; }
  raw(u) { const r = this.last.get(u); return `# ${r.title}\n\nBuy New\n\n$${r.price.toFixed(2)}\n\nSold by: ${r.seller}\n\n${r.stock}\n\n_${r.rating} out of 5 stars_`; }
}
const stub = async (snip) => {        // second extractor: agrees everywhere except it reads Sony price wrong
  const title = /^# (.+)$/m.exec(snip)[1];
  const price = Number(/\$([\d.]+)/.exec(snip)[1]) + (title.includes("Sony") ? 10 : 0);
  return { title, price, stock: /(In stock|Low stock|Out of stock)/.exec(snip)[1], rating: Number(/_([\d.]+) out of 5/.exec(snip)[1]), seller: /Sold by: (.+)/.exec(snip)[1] };
};
const db = connect(join(mkdtempSync(join(tmpdir(), "r18-")), "pins.db"));
const text = await buildReport(new WithRaw(), db, [], { extractor: stub });
const sonyPinned = db.prepare("SELECT COUNT(*) n FROM pins WHERE fact_text LIKE ?").get("%sony%").n;
const total = db.prepare("SELECT COUNT(*) n FROM pins").get().n;
console.log([/4 of 5 pages corroborated/.test(text), /1 held/.test(text), sonyPinned === 0, total === 20, !/1b78a1d31a3b|85dd78b6c3fb/.test(text)].join(","));' 2>/dev/null)
gate_clean=$(grep -cE "extract|liquid|agent" veto/gate.ts)
if [ "$r18" = "true,true,true,true,true" ] && [ "$gate_clean" = 0 ]; then echo "R18 PASS (disagreeing page held: 0 Sony pins, 20/25 pinned, report says 1 held; gate imports no extractor)"
else echo "R18 FAIL ($r18 gate_refs=$gate_clean)"; fail=1; fi

# R19 — L3: the refusal explanation can't smuggle a claim past the checker
r19=$($NODE --input-type=module -e '
const { checkClaims } = await import("./veto/agent.ts");
const facts = [{ pin_id: "facc55e34ae8", fact: "price of Bose QuietComfort Ultra was 327.99 USD when the report was drafted" },
               { pin_id: "dd820457083a", fact: "price of Bose QuietComfort Ultra is now 278.79 USD" }];
const r = checkClaims("Bose dropped from 327.99 USD [pin:facc55e34ae8] to 278.79 USD [pin:dd820457083a]. Bose will fall to 199.00 USD [pin:dd820457083a]. Competitors are cutting prices everywhere. Sony moved too [pin:0000aaaa1111].", facts);
console.log(r.kept.length, r.dropped.length);')
live19=""
if [ -n "$OPENROUTER_API_KEY" ] || [ -n "$VETO_LIQUID_URL" ]; then
  VETO_STREAM=off $NODE veto/simulate.ts --drift >/dev/null 2>&1
  live19=$(tail -1 veto/receipts.jsonl | $NODE -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const ok=new Set(r.drifted_facts.flatMap(d=>[d.pin_id,d.new_hash.slice(0,12)]));const e=r.explanation??[];const cited=e.flatMap(s=>[...s.matchAll(/\[pin:([0-9a-f]+)\]/g)].map(m=>m[1]));console.log(e.length+" "+cited.every(c=>ok.has(c)))')
fi
if [ "$r19" = "1 3" ] && { [ -z "$live19" ] || [ "${live19#* }" = true ]; }; then
  echo "R19 PASS (checker kept 1/4 explanation sentences; live receipt explanation: ${live19:-not run} — cites only the drifted old/new facts)"
else echo "R19 FAIL (unit=$r19 live=$live19)"; fail=1; fi

# R20 — T3 stream + T2 volatility: events reach Tinybird without the evidence sync, and history is queryable
if [ -z "$TINYBIRD_TOKEN" ]; then echo "R20 SKIP (no TINYBIRD_TOKEN)"; else
  VETO_AGENT=off $NODE veto/simulate.ts --drift >/dev/null 2>&1
  sess=$(sqlite3 veto/pins.db "select v from meta where k='session'"); run_at=$(tail -1 veto/runs.jsonl | $NODE -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).run_at)')
  n=0; for i in 1 2 3 4 5 6 7 8 9 10; do
    n=$(curl -s -m 10 "$TINYBIRD_HOST/v0/sql" -H "Authorization: Bearer $TINYBIRD_TOKEN" --data-urlencode "q=SELECT uniqExact(event_id) FROM vault_events WHERE session='$sess' AND kind='check' AND startsWith(event_id, '$run_at') FORMAT TSV")
    [ "$n" = 25 ] && break; sleep 1.5; done
  vol=$(curl -s -m 10 "$TINYBIRD_HOST/v0/pipes/vault_volatility.json?adapter=mock" -H "Authorization: Bearer $TINYBIRD_TOKEN" | $NODE -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")).data;console.log(d.filter(r=>r.field==="price"&&r.drifts>0).length)')
  if [ "$n" = 25 ] && [ "${vol:-0}" -ge 1 ]; then echo "R20 PASS (streamed 25/25 check events for the run before any evidence sync; volatility pipe ranks the drifted price)"
  else echo "R20 FAIL (streamed checks=$n volatility_rows=$vol)"; fail=1; fi
fi

# R21 — the north star can't hide a contradiction: force a ship that cites the injected fact, it must be counted
cp veto/runs.jsonl "$TMPDIR/r21_runs.bak" 2>/dev/null; cp veto/report.md "$TMPDIR/r21_report.bak" 2>/dev/null
r21=$(VETO_AGENT=off VETO_STREAM=off $NODE --input-type=module -e '
const { getAdapter } = await import("./veto/adapters.ts");
const { draft, decide } = await import("./veto/ship.ts");
const { citedPriceTarget } = await import("./veto/worlds.ts");
const a = getAdapter("mock"); const text = await draft(a); const url = citedPriceTarget(text, 0);
// Simulate a BROKEN gate: the world is unchanged (so the gate says CLEAN) but ground truth says this fact was injected.
const r = await decide(text, a, { mode: "drift", injected: { url, field: "price" } });
console.log(r.shipped);' 2>/dev/null | tail -1)
c=$(VETO_STREAM=off TINYBIRD_HOST=http://127.0.0.1:9 $NODE veto/evidence.ts | grep -oE '[0-9]+ shipped contradictions' | grep -oE '^[0-9]+')
cp "$TMPDIR/r21_runs.bak" veto/runs.jsonl 2>/dev/null; cp "$TMPDIR/r21_report.bak" veto/report.md 2>/dev/null
if [ "$r21" = true ] && [ "${c:-0}" -ge 1 ]; then echo "R21 PASS (a shipped report citing the injected fact is counted: $c shipped contradiction(s); veto restored)"
else echo "R21 FAIL (shipped=$r21 counted=$c)"; fail=1; fi

# R22 — deterministic citation repair can't launder a claim: invented numbers and cross-product prices still drop
r22=$($NODE --input-type=module -e '
const { repairCitations, checkClaims } = await import("./veto/agent.ts");
const basis = [
  { pin_id: "aaaa00000001", fact: "price of Sony WH-1000XM5 is 298.00 USD", product: "Sony WH-1000XM5" },
  { pin_id: "aaaa00000002", fact: "rating of Sony WH-1000XM5 is 4.2 out of 5", product: "Sony WH-1000XM5" },
  { pin_id: "bbbb00000001", fact: "price of Bose QuietComfort Ultra is 327.99 USD", product: "Bose QuietComfort Ultra" }];
const claims = ["Sony WH-1000XM5 is 298.00 USD with a 4.2 rating.", "Sony WH-1000XM5 is 199.00 USD.", "Sony WH-1000XM5 costs 327.99 USD.", "Sony WH-1000XM5 undercuts Bose QuietComfort Ultra [pin:aaaa00000001]."];
const r = checkClaims(claims.map((c) => repairCitations(c, basis).sentence).join(" "), basis);
console.log(r.kept.length, r.dropped.length);')
if [ "$r22" = "1 3" ]; then echo "R22 PASS (repair kept the 1 true claim; invented price, cross-product price and one-sided comparison all dropped)"
else echo "R22 FAIL ($r22)"; fail=1; fi

exit $fail
