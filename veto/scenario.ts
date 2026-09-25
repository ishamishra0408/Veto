// The retail villain as a multi-step plan: plan → act (collect) → observe (corroborate, pin) → reason
// (comparables → anchor → recommendation) → act (draft) → observe (gate) → self-correct (impact → re-base → ship).
//   default (villain)  -> the anchor competitor drops 15% at 21:00; gate REFUSES; with --rebase: re-plan, re-pin, ship
//   --clean            -> nothing injected (mock: CLEAN; live: whatever the real page does)
// Clock labels are narrative; the run itself takes seconds to a minute.
import { getAdapter, pageUrls } from "./adapters.ts";
import { impactOf, Plan } from "./planner.ts";
import { lastBuild, RULE } from "./report.ts";
import { decide, draft } from "./ship.ts";
import { citedPriceTarget, PriceShift } from "./worlds.ts";
import { citedPinIds } from "./pins.ts";
const ansi = (c: string) => (process.stdout.isTTY ? `\x1b[${c}m` : ""); // color only on a terminal

const clean = process.argv.includes("--clean");
const rebase = process.argv.includes("--rebase");
const say = (clock: string, msg: string) => console.log(`${ansi("1")}[${clock}]${ansi("0")} ${msg}`);
const base = getAdapter();

const plan = new Plan(
  `recommend a price for our headphones: undercut the cheapest comparable competitor (in stock, rated ≥ ${RULE.minRating.toFixed(1)}) by ${RULE.undercut * 100}%`,
  [
    { id: "P1", kind: "plan", title: "decompose goal into facts + conclusions" },
    { id: "P2", kind: "act", title: `collect ${pageUrls().length} competitor pages via ${base.name}` },
    { id: "P3", kind: "observe", title: "corroborate (2 extractors) and pin every fact" },
    { id: "P4", kind: "reason", title: "select comparables" },
    { id: "P5", kind: "reason", title: "anchor → recommended price" },
    { id: "P6", kind: "act", title: "draft report (every conclusion cites its pins)" },
    { id: "P7", kind: "observe", title: "06:00 gate: re-fetch, re-hash, compare" },
    { id: "P8", kind: "correct", title: "self-correct: impact → re-pin → recompute → disclose → re-gate" },
  ]);
plan.mark("P1", "done", "needs per competitor: title, price, stock, rating, seller → conclusions: comparables, anchor, recommendation, findings");

say("18:00 T0", `fetching ${pageUrls().length} competitor pages via ${base.name}; pinning every fact`);
const text = await draft(base);
plan.mark("P2", "done", `${lastBuild.pages} pages fetched`);
plan.mark("P3", lastBuild.held ? "replanned" : "done", lastBuild.held
  ? `${lastBuild.held} page(s) held (extractors disagreed) → comparable set re-planned without them`
  : lastBuild.parserOnly ? `${lastBuild.parserOnly} page(s) parser-only (second extractor unavailable)` : `${lastBuild.corroborated || lastBuild.pages} page(s) pinned`);
const comps = lastBuild.conclusions.find((c) => c.id === "comparables");
plan.mark("P4", comps ? "done" : "failed", comps ? `${comps.pins.length / 3} comparable competitor(s)` : "no comparable competitor");
plan.recommendation.before = lastBuild.recommended;
plan.mark("P5", lastBuild.recommended !== null ? "done" : "failed", lastBuild.recommended !== null ? `recommended $${lastBuild.recommended.toFixed(2)}` : "no anchor");
const conclusions0 = [...lastBuild.conclusions];
plan.mark("P6", "done", `${conclusions0.length} conclusions citing ${citedPinIds(text).length} pins, 0 URLs`);
say("overnight", `agent reasons over the pinned basis only → draft cites ${citedPinIds(text).length} pins, 0 URLs`);

// The villain drops the price that matters: the anchor competitor the recommendation rests on.
const target = clean ? null : (lastBuild.anchorUrl || citedPriceTarget(text));
if (!clean && !target) { console.log("no cited price to drift — nothing passed ingest"); process.exit(1); }
const world = clean || !target ? base : new PriceShift(base, target, (p) => p * 0.85);
say("21:00 T1", clean
  ? (base.name === "mock" ? "competitor prices hold" : "nothing injected — any change from here on is the live page itself")
  : "competitor drops one price 15% (simulated) — the pipeline doesn't notice");

say("06:00 gate", "re-fetch → re-hash → compare, before anything ships");
// Ground truth: mock + no injection = clean. Live + no injection = unknown (the real world may move).
const live = base.name !== "mock";
function onRefused(verdict: import("./gate.ts").Verdict) {
  plan.mark("P7", "failed", `REFUSED (${verdict.status})`);
if (verdict.status === "DRIFTED") {
  if (clean) console.log(`\nNothing was injected — the live page moved on its own between 18:00 and 06:00.`);
  console.log("\nThe draft that would have shipped:");
  const rows = new Map<string, typeof verdict.drifted>();
  for (const d of verdict.drifted) {
    const line = text.split("\n").find((l) => l.includes(`[pin:${d.pin_id}]`)) ?? "";
    rows.set(line, [...(rows.get(line) ?? []), d]);
  }
  for (const [line, ds] of rows) {
    let shown = line;
    for (const d of ds) shown = shown.replace(`[pin:${d.pin_id}]`, `${ansi("1;33")}[pin:${d.pin_id}]${ansi("0")}`);
    console.log(`  ${shown}`);
    for (const d of ds) console.log(`  ↳ pinned ${d.field} ${d.old_value}; live at 6am: ${ansi("1;31")}${d.new_value}${ansi("0")}.`);
  }
  console.log("  Shipping this = pricing against a ghost.");
  const imp = impactOf(conclusions0, verdict.drifted);
  plan.impact = imp;
  console.log(`\n${ansi("1;34")}[plan impact]${ansi("0")} drift breaks ${imp.affected.length} of ${conclusions0.length} conclusions: ${imp.affected.map((a) => a.label).join(", ") || "none"}; ${imp.unaffected} still hold`);
}
}
const { verdict, shipped, rebased } = await decide(text, world, { mode: clean ? (live ? "live" : "clean") : "drift", rebase,
  onRefused, ...(target ? { injected: { url: target, field: "price" }, injectedFactor: 0.85 } : {}) });
if (verdict.status === "CLEAN") plan.mark("P7", "done", "CLEAN — basis still true");

if (verdict.status === "CLEAN") plan.mark("P8", "skipped", "nothing to correct");
else if (rebased) {
  plan.recommendation.after = lastBuild.recommended;
  const r = plan.recommendation;
  plan.mark("P8", "done", `re-pinned changed facts, recomputed${r.before !== r.after ? ` recommendation $${r.before?.toFixed(2)} → $${r.after?.toFixed(2)}` : " (recommendation unchanged)"}, disclosed as [was-pin:], re-gated CLEAN, shipped`);
} else plan.mark("P8", rebase ? "failed" : "skipped", rebase ? "re-base could not reach a clean basis" : "not requested (--rebase) — refused, receipt written");
// Villain night succeeds only if the drift was caught (REFUSED) and, when asked, corrected (re-based and shipped).
process.exit(clean ? (shipped ? 0 : 2) : verdict.status !== "CLEAN" && (!rebase || rebased) ? 0 : 1);
