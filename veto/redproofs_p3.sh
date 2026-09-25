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
# night 2 must refuse the drift (receipt) and then self-correct: re-based, shipped, 0 contradictions
if [ $c1 -eq 0 ] && [ $c2 -eq 0 ] && [ "$v1" = "$v2" ] && [ "$(echo "$v1" | tail -2 | head -1)" = "VERDICT: REFUSED (DRIFTED)" ] \
   && [ "$(echo "$v1" | tail -1)" = "VERDICT: CLEAN" ] && echo "$o1" | grep -q "shipped re-based" && echo "$o1" | grep -q "0 shipped contradictions" \
   && [ "${r1:-0}" -ge 1 ] && [ "$r1" = "$r2" ]; then
  echo "R9 PASS (2 runs, identical verdicts [$(echo $v1 | tr '\n' ' ')], $r1 receipt each, refused → re-based → shipped, 0 contradictions)"
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
if [ "$r21" = true ] && [ "${c:-0}" -ge 1 ]; then echo "R21 PASS (a shipped report citing the injected fact is counted: $c shipped contradiction(s); state restored)"
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

# R23 — the plan is a real dependency graph: a drift on the anchor breaks exactly the conclusions that cite it,
# and self-correction recomputes the recommendation from the new fact
rm -f veto/pins.db veto/receipts.jsonl veto/runs.jsonl veto/plan.json
out=$(VETO_AGENT=off VETO_STREAM=off $NODE veto/scenario.ts --rebase 2>/dev/null); rc=$?
r23=$($NODE -e '
const p=JSON.parse(require("fs").readFileSync("veto/plan.json","utf8"));
const st=Object.fromEntries(p.steps.map(s=>[s.id,s.status]));
const aff=(p.impact?.affected??[]).map(a=>a.id);
const b=p.recommendation.before, a=p.recommendation.after;
const expect=Math.round(Math.round(b/0.97*0.85*100)/100*0.97*100)/100;   // anchor × 0.85, then the 3% rule
console.log([st.P7==="failed", st.P8==="done", aff.includes("anchor"), aff.includes("recommendation"), !aff.includes("comparables"), p.impact.unaffected>0, a!==b, Math.abs(a-expect)<0.02].join(","))')
vr=$($NODE veto/verify_pins.ts >/dev/null 2>&1; echo $?)
if [ $rc -eq 0 ] && [ "$r23" = "true,true,true,true,true,true,true,true" ] && grep -q '\[was-pin:' veto/report.md && [ "$vr" = 0 ]; then
  echo "R23 PASS (plan P1–P8 logged; drift on the anchor breaks exactly the conclusions citing it (anchor, recommendation, …) while the comparable set still holds; recommendation recomputed; re-based report verifies)"
else echo "R23 FAIL (rc=$rc checks=$r23 verify=$vr)"; echo "$out" | grep -E '^\[plan' | head -12; fail=1; fi

# R24 — the reviewer's 5 probes: partial-number, boilerplate "5", reversed comparison, speculation, wrong field
r24=$($NODE --input-type=module -e '
const { checkClaims } = await import("./veto/agent.ts");
const B = [{ pin_id:"aaaa00000001", fact:"price of Sony WH-1000XM5 is 298.00 USD", product:"Sony WH-1000XM5" },
  { pin_id:"aaaa00000002", fact:"rating of Sony WH-1000XM5 is 4.2 out of 5", product:"Sony WH-1000XM5" },
  { pin_id:"cccc00000001", fact:"price of JBL Tune 770NC is 129.95 USD", product:"JBL Tune 770NC" },
  { pin_id:"dddd00000001", fact:"price of Sennheiser Momentum 4 is 287.00 USD", product:"Sennheiser Momentum 4" }];
const r = checkClaims([
  "Sony WH-1000XM5 costs only 29 USD [pin:aaaa00000001].", "Sony WH-1000XM5 has a perfect 5 star rating [pin:aaaa00000002].",
  "Sony WH-1000XM5 is cheaper than JBL Tune 770NC [pin:aaaa00000001][pin:cccc00000001].",
  "Sony WH-1000XM5 is the best value and will drop next week [pin:aaaa00000001].", "Sony WH-1000XM5 is out of stock [pin:aaaa00000001].",
  "JBL Tune 770NC is cheaper than Sony WH-1000XM5 at 129.95 USD [pin:cccc00000001][pin:aaaa00000001].",
  "Sony WH-1000XM5 is rated 4.2 out of 5 [pin:aaaa00000002].", "Sennheiser Momentum 4 costs 287.00 USD [pin:dddd00000001]."].join(" "), B);
console.log(r.kept.length, r.dropped.length);')
if [ "$r24" = "3 5" ]; then echo "R24 PASS (all 5 reviewer probes dropped; 3 true claims — incl. a correct comparison and a model number — kept)"
else echo "R24 FAIL ($r24)"; fail=1; fi

# R25 — H: a competitor page lost at 18:00 is re-planned: search finds a comparable, it is pinned, cited, and ships
rm -f veto/pins.db veto/receipts.jsonl veto/runs.jsonl veto/plan.json
VETO_AGENT=off VETO_STREAM=off $NODE veto/scenario.ts --clean --lose-page >/dev/null 2>&1; rc=$?
p3=$($NODE -e 'const p=JSON.parse(require("fs").readFileSync("veto/plan.json","utf8"));const s=p.steps.find(x=>x.id==="P3");console.log(s.status+"|"+s.detail)')
if [ $rc -eq 0 ] && echo "$p3" | grep -q "^replanned|.*searched and pinned a comparable" && grep -q "WH-1000XM4" veto/report.md && $NODE veto/verify_pins.ts >/dev/null; then
  echo "R25 PASS (lost page → search → comparable pinned + cited → CLEAN ship; plan P3 re-planned)"
else echo "R25 FAIL (rc=$rc p3=$p3)"; fail=1; fi

# R26 — G: the re-base re-fetches only the drifted page and reuses the rest from their pins
rm -f veto/pins.db veto/receipts.jsonl veto/runs.jsonl
VETO_AGENT=off VETO_STREAM=off $NODE veto/scenario.ts --rebase >/dev/null 2>&1; rc=$?
r26=$(tail -1 veto/runs.jsonl | $NODE -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(r.verdict,r.final_verdict,r.rebase_fetched,r.shipped,r.rebased)')
if [ $rc -eq 0 ] && [ "$r26" = "REFUSED CLEAN 1 true true" ]; then echo "R26 PASS (refused → re-based fetching 1 of 5 pages → re-gated CLEAN → shipped)"
else echo "R26 FAIL (rc=$rc $r26)"; fail=1; fi

# R27 — F: a drift that flaps back on the confirm fetch is classified "flap" and COUNTED as a false refusal
cp veto/runs.jsonl "$TMPDIR/r27_runs.bak"; cp veto/receipts.jsonl "$TMPDIR/r27_rc.bak"
r27=$(VETO_AGENT=off VETO_STREAM=off $NODE --input-type=module -e '
const { FetchAdapter, getAdapter } = await import("./veto/adapters.ts");
const { draft, decide } = await import("./veto/ship.ts");
const { citedPriceTarget } = await import("./veto/worlds.ts");
const base = getAdapter("mock"); const text = await draft(base); const url = citedPriceTarget(text, 0);
let n = 0;   // the gate sees a changed price; the confirm fetch sees the pinned price again (a flapping source)
class Flap extends FetchAdapter { name = "mock"; async fetch(u) { const r = await base.fetch(u); return u === url && n++ === 0 ? { ...r, price: r.price - 1 } : r; } }
await decide(text, new Flap(), { mode: "live" });' >/dev/null 2>&1; tail -1 veto/runs.jsonl | $NODE -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(r.verdict,r.false_refusal,(r.drift_classes||[]).join())')
fr=$(VETO_STREAM=off TINYBIRD_HOST=http://127.0.0.1:9 $NODE veto/evidence.ts | grep -oE '[0-9]+ false refusals' | grep -oE '^[0-9]+')
cp "$TMPDIR/r27_runs.bak" veto/runs.jsonl; cp "$TMPDIR/r27_rc.bak" veto/receipts.jsonl
if [ "$r27" = "REFUSED 1 flap" ] && [ "${fr:-0}" -ge 1 ]; then echo "R27 PASS (flapping source → class flap → counted: $fr false refusal(s); state restored)"
else echo "R27 FAIL ($r27 counted=$fr)"; fail=1; fi

# R28 — E: basis_window is when THIS basis was observed, not when each fact was first seen
rm -f veto/pins.db veto/receipts.jsonl veto/runs.jsonl
r28=$(VETO_AGENT=off VETO_STREAM=off $NODE --input-type=module -e '
const { getAdapter } = await import("./veto/adapters.ts");
const { draft, decide } = await import("./veto/ship.ts");
const { PriceShift, citedPriceTarget } = await import("./veto/worlds.ts");
const { readFileSync } = await import("node:fs");
const base = getAdapter("mock"); await draft(base); const t1 = new Date().toISOString();
await new Promise((r) => setTimeout(r, 60));
const text = await draft(base);
await decide(text, new PriceShift(base, citedPriceTarget(text, 0), (p) => p - 5), { mode: "drift" });
const rc = JSON.parse(readFileSync("veto/receipts.jsonl", "utf8").trim().split("\n").pop());
console.log(rc.basis_window.from > t1);' 2>/dev/null | tail -1)
if [ "$r28" = true ]; then echo "R28 PASS (receipt basis_window starts at the second observation, not the first sighting)"
else echo "R28 FAIL ($r28)"; fail=1; fi

# R29 — C: a parser-only page is never relabelled "corroborated"; only agreed pages are re-used
r29=$(VETO_AGENT=off $NODE --input-type=module -e '
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const { FetchAdapter, getAdapter } = await import("./veto/adapters.ts");
const { buildReport } = await import("./veto/report.ts"); const { connect } = await import("./veto/pins.ts");
const base = getAdapter("mock");
class WithRaw extends FetchAdapter { name = "test"; last = new Map();
  async fetch(u) { const r = await base.fetch(u); this.last.set(u, r); return r; }
  raw(u) { const r = this.last.get(u); return `# ${r.title}\n\nBuy New\n\n$${r.price.toFixed(2)}\n\nSold by: ${r.seller}\n\n${r.stock}\n\n_${r.rating} out of 5 stars_`; } }
const down = async () => { throw new Error("model down"); };
const agree = async (snip) => ({ title: /^# (.+)$/m.exec(snip)[1], price: Number(/\$([\d.]+)/.exec(snip)[1]),
  stock: /(In stock|Low stock|Out of stock)/.exec(snip)[1], rating: Number(/_([\d.]+) out of 5/.exec(snip)[1]), seller: /Sold by: (.+)/.exec(snip)[1] });
const db = connect(join(mkdtempSync(join(tmpdir(), "r29-")), "pins.db")); const a = new WithRaw();
const ing = async (x) => (await buildReport(a, db, [], { extractor: x })).split("\n").find((l) => l.startsWith("Ingest:"));
const l1 = await ing(down), l2 = await ing(agree), l3 = await ing(agree);
console.log([/0 of 5 pages corroborated now/.test(l1) && /5 parser-only/.test(l1), /5 of 5 pages corroborated now/.test(l2) && !/re-used/.test(l2), /5 re-used/.test(l3)].join(","));' 2>/dev/null)
if [ "$r29" = "true,true,true" ]; then echo "R29 PASS (parser-only stays parser-only; corroborated only after a real second read; re-used only when agreed)"
else echo "R29 FAIL ($r29)"; fail=1; fi

# R30 — a source whose seller changes on every fetch can't be pinned: the re-plan marks it unstable, stops relying
# on it (shown without a pin), and still converges to a shipped report
rm -f veto/pins.db veto/receipts.jsonl veto/runs.jsonl
r30=$(VETO_AGENT=off VETO_STREAM=off $NODE --input-type=module -e '
const { FetchAdapter, getAdapter } = await import("./veto/adapters.ts");
const { draft, decide } = await import("./veto/ship.ts");
const { citedPriceTarget } = await import("./veto/worlds.ts");
const { readFileSync } = await import("node:fs");
const base = getAdapter("mock"); const text = await draft(base); const url = citedPriceTarget(text, 0);
let n = 0;   // after pinning: the price drops once (real move) and the seller rotates on EVERY fetch (buy-box flapping)
class Rotating extends FetchAdapter { name = "mock";
  async fetch(u) { const r = await base.fetch(u); return u === url ? { ...r, price: r.price - 10, seller: `Seller ${n++}` } : r; } }
const r = await decide(text, new Rotating(), { mode: "drift", rebase: true });
const rep = readFileSync("veto/report.md", "utf8");
console.log([r.shipped && r.rebased, /\(unstable, not relied on\)/.test(rep), /## Not relied on/.test(rep)].join(","));' 2>/dev/null | tail -1)
vr=$($NODE veto/verify_pins.ts >/dev/null 2>&1; echo $?)
if [ "$r30" = "true,true,true" ] && [ "$vr" = 0 ]; then echo "R30 PASS (rotating seller marked unstable, shown without a pin, report re-based and shipped; verifies)"
else echo "R30 FAIL ($r30 verify=$vr)"; fail=1; fi

exit $fail
