// Counts, not adjectives. Computed locally from pins.db + receipts.jsonl + runs.jsonl (the truth);
// the Tinybird pipe serves the same counts and must agree. No network -> local counts, exit 0.
import { existsSync, readFileSync } from "node:fs";
import { connect, sessionOf } from "./pins.ts";
import { RECEIPTS } from "./receipts.ts";
import { RUNS } from "./ship.ts";
import { eventsFor } from "./stream.ts";
import { remoteCounts, volatility, type Counts } from "./tinybird.ts";

const jsonl = (u: URL) =>
  existsSync(u) ? readFileSync(u, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

const db = connect();
const session = sessionOf(db);
const pins = db.prepare("SELECT pin_id, fetched_at FROM pins").all() as { pin_id: string; fetched_at: string }[];
const receipts = jsonl(RECEIPTS);
const runs = jsonl(RUNS);

// Ground truth comes from the injected world, not from the gate: a shipped, non-re-based report that cites the
// exact fact the injector changed is a shipped contradiction (recorded per run by ship.ts).
const local: Counts = {
  pinned: pins.length,
  drifted_flagged: receipts.reduce((s, r) => s + r.drifted_facts.length, 0),
  shipped_contradictions: runs.filter((r) => r.contradiction === 1).length,
  clean_shipped: runs.filter((r) => r.verdict === "CLEAN" && r.shipped).length,
  false_refusals: runs.filter((r) => r.verdict === "REFUSED" && r.mode === "clean").length,
  unforced_refusals: runs.filter((r) => r.verdict === "REFUSED" && r.mode === "live").length,
  // T1 guardrail: nearest-rank p95 of gate wall time (same formula as the Tinybird pipe).
  gate_p95_ms: (() => { const ms = runs.map((r) => Number(r.gate_ms ?? 0)).sort((a, b) => a - b);
    return ms.length ? ms[Math.ceil(0.95 * ms.length) - 1] : 0; })(),
};

console.log(`north star: ${local.pinned} facts pinned · ${local.drifted_flagged} drifted-and-flagged · ${local.shipped_contradictions} shipped contradictions`);
console.log(`counter: ${local.clean_shipped} clean runs shipped · ${local.false_refusals} false refusals`);
// Live runs with no injection have no ground truth; a refusal there is the real world moving, reported separately.
const selfCorrected = runs.filter((r) => r.verdict === "REFUSED" && r.rebased && r.shipped).length;
if (selfCorrected) console.log(`self-correct: ${selfCorrected} refusal(s) re-planned, re-pinned and shipped with the change disclosed`);
console.log(`guardrail: gate p95 ${local.gate_p95_ms} ms over ${runs.length} run(s)`);
if (local.unforced_refusals) console.log(`live: ${local.unforced_refusals} unforced drift refusal(s) — nothing injected, the real page changed`);

const events = eventsFor(session, pins, receipts, runs);
try {
  // Push once, then re-read: freshly ingested rows can take a moment to become queryable.
  let remote = await remoteCounts(events, session);
  const differs = (r: Counts) => (Object.keys(local) as (keyof Counts)[]).filter((k) => local[k] !== r[k]);
  for (let i = 0; i < 10 && differs(remote).length; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    remote = await remoteCounts([], session);
  }
  const diff = differs(remote);
  if (diff.length) console.log(`evidence source: local (Tinybird pipe DISAGREES on ${diff.map((k) => `${k} ${remote[k]}≠${local[k]}`).join(", ")}; local is truth)`);
  else console.log(`evidence source: Tinybird pipe vault_evidence — matches local (session ${session.slice(0, 8)})`);
} catch (e) {
  console.log(`evidence source: local (Tinybird offline: ${(e as Error).message.slice(0, 80)})`);
}

// T2: history across every live run (Tinybird only — local state resets with each demo).
try {
  const titles = new Map((db.prepare("SELECT source_url, fact_text FROM pins WHERE fact_text LIKE 'title of %'").all() as { source_url: string; fact_text: string }[])
    .map((r) => [r.source_url, r.fact_text.split(" is ").slice(1).join(" is ").split(/[,(-]/)[0].trim().slice(0, 32)]));
  const vol = (await volatility()).filter((v) => v.drifts > 0).slice(0, 3);
  if (vol.length) console.log(`volatility (all live runs, Tinybird): ${vol.map((v) => `${titles.get(v.url) ?? v.url.split("/").pop()} ${v.field} ${v.drifts}/${v.checks}`).join(" · ")}`);
} catch { /* offline: volatility needs history only Tinybird keeps */ }
