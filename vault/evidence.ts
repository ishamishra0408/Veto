// Counts, not adjectives. Computed locally from pins.db + receipts.jsonl + runs.jsonl (the truth);
// the Tinybird pipe serves the same counts and must agree. No network -> local counts, exit 0.
import { existsSync, readFileSync } from "node:fs";
import { connect, sessionOf } from "./pins.ts";
import { RECEIPTS } from "./receipts.ts";
import { RUNS } from "./ship.ts";
import { remoteCounts, type Counts, type VaultEvent } from "./tinybird.ts";

const jsonl = (u: URL) =>
  existsSync(u) ? readFileSync(u, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

const db = connect();
const session = sessionOf(db);
const pins = db.prepare("SELECT pin_id, fetched_at FROM pins").all() as { pin_id: string; fetched_at: string }[];
const receipts = jsonl(RECEIPTS);
const runs = jsonl(RUNS);

// Ground truth comes from the injected world, not from the gate: a shipped run on a drifted world
// that was not re-based is a shipped contradiction.
const local: Counts = {
  pinned: pins.length,
  drifted_flagged: receipts.reduce((s, r) => s + r.drifted_facts.length, 0),
  shipped_contradictions: runs.filter((r) => r.shipped && r.mode === "drift" && !r.rebased).length,
  clean_shipped: runs.filter((r) => r.verdict === "CLEAN" && r.shipped).length,
  false_refusals: runs.filter((r) => r.verdict === "REFUSED" && r.mode === "clean").length,
  unforced_refusals: runs.filter((r) => r.verdict === "REFUSED" && r.mode === "live").length,
};

console.log(`north star: ${local.pinned} facts pinned · ${local.drifted_flagged} drifted-and-flagged · ${local.shipped_contradictions} shipped contradictions`);
console.log(`counter: ${local.clean_shipped} clean runs shipped · ${local.false_refusals} false refusals`);
// Live runs with no injection have no ground truth; a refusal there is the real world moving, reported separately.
if (local.unforced_refusals) console.log(`live: ${local.unforced_refusals} unforced drift refusal(s) — nothing injected, the real page changed`);

const base = { session, n_drifted: 0, verdict: "", mode: "", shipped: 0, rebased: 0 };
const events: VaultEvent[] = [
  ...pins.map((p) => ({ ...base, kind: "pin" as const, event_id: p.pin_id, ts: p.fetched_at })),
  ...receipts.map((r) => ({ ...base, kind: "receipt" as const, event_id: `${r.refused_at}|${r.reason}`, ts: r.refused_at, n_drifted: r.drifted_facts.length })),
  ...runs.map((r) => ({ ...base, kind: "run" as const, event_id: `${r.run_at}|${r.mode}`, ts: r.run_at,
    verdict: r.verdict, mode: r.mode, shipped: r.shipped ? 1 : 0, rebased: r.rebased ? 1 : 0 })),
];
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
