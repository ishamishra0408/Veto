// The only path that writes report.md: draft -> gate -> ship on CLEAN, else receipt (+ optional re-base).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getAdapter, type FetchAdapter } from "./adapters.ts";
import { revalidate, type Drift, type Verdict } from "./gate.ts";
import { citedPinIds, connect, DB_PATH, factValue, PIN_LEN, sessionOf, type Pin } from "./pins.ts";
import { checkClaims, shortName, type BasisFact } from "./agent.ts";
import { appendReceipt, appendShip } from "./receipts.ts";
import { emit, eventsFor, flush } from "./stream.ts";
import { buildReport, DRAFT, lastBuild, REPORT } from "./report.ts";
const ansi = (c: string) => (process.stdout.isTTY ? `\x1b[${c}m` : ""); // color only on a terminal

export const RUNS = new URL("./runs.jsonl", import.meta.url);

export interface RunMeta {
  mode: string; // clean | drift | outage | live — ground truth of the injected world
  rebase?: boolean;
  injected?: { url: string; field: string }; // the fact the injector changed (ground truth for contradictions)
  injectedFactor?: number; // e.g. 0.85 for the villain's −15%
}

export async function draft(adapter: FetchAdapter, disclosures: Drift[] = []): Promise<string> {
  const db = connect();
  const text = await buildReport(adapter, db, disclosures);
  db.close();
  writeFileSync(DRAFT, text);
  return text;
}

// L3: why the report was blocked, in plain English — written deterministically from the receipt (never a model),
// so the sentence is always true. Each sentence cites the pinned (old) fact and the fresh (new) fact.
function whyFacts(v: Extract<Verdict, { status: "DRIFTED" }>): BasisFact[] {
  const db = connect();
  const titleOf = db.prepare("SELECT * FROM pins WHERE source_url = ? AND fact_text LIKE 'title of %' LIMIT 1");
  const title = (url: string) => {
    const pin = titleOf.get(url) as unknown as Pin | undefined;
    return pin ? shortName(factValue(pin)) : "a tracked product";
  };
  const out = v.drifted.flatMap((d) => [
    { pin_id: d.pin_id, fact: `${d.field} of ${title(d.source_url)} was ${d.old_value} when the report was drafted` },
    { pin_id: d.new_hash.slice(0, PIN_LEN), fact: `${d.field} of ${title(d.source_url)} is now ${d.new_value}` },
  ]);
  db.close();
  return out;
}

async function announce(v: Verdict) {
  if (v.status === "CLEAN") return null;
  let why: { kept: string[] } | null = null;
  if (v.status === "DRIFTED") {
    const facts = whyFacts(v);
    const product = (f: BasisFact) => /^\w+ of (.+?) (?:was|is now) /.exec(f.fact)?.[1] ?? "a tracked product";
    const text = v.drifted.map((d, i) => {
      const [was, now] = [facts[2 * i], facts[2 * i + 1]];
      return `${product(was)} ${d.field} changed from ${d.old_value} [pin:${was.pin_id}] to ${d.new_value} [pin:${now.pin_id}] after the draft cited it.`;
    }).join(" ");
    why = checkClaims(text, facts); // same checker as the agent: the deterministic sentence must pass it too
  }
  const receipt = appendReceipt(v, why?.kept ?? []);
  console.log(`${ansi("1;31")}VERDICT: REFUSED (${v.status})${ansi("0")} — report.md not written`);
  if (v.status === "DRIFTED")
    for (const d of v.drifted) console.log(`  drift [pin:${d.pin_id}] ${d.field}: ${d.old_value} -> ${d.new_value}`);
  else console.log(`  ${v.error}`);
  for (const w of why?.kept ?? []) console.log(`  ${ansi("1")}WHY:${ansi("0")} ${w}`);
  console.log(`RECEIPT: ${JSON.stringify(receipt)}`);
  return receipt;
}

export async function decide(text: string, world: FetchAdapter, meta: RunMeta) {
  const verdict = await revalidate(DB_PATH, world, citedPinIds(text));
  let shipped = false, rebased = false;
  const receipts: (ReturnType<typeof appendReceipt> | null)[] = [];
  if (verdict.status === "CLEAN") {
    writeFileSync(REPORT, text);
    appendShip(verdict);
    shipped = true;
    console.log(`${ansi("1;32")}VERDICT: CLEAN${ansi("0")} — shipped report.md (${verdict.pin_hashes.length} pins revalidated)`);
  } else {
    receipts.push(await announce(verdict));
    if (meta.rebase && verdict.status === "DRIFTED") {
      const next = await draft(world, verdict.drifted);
      const v2 = await revalidate(DB_PATH, world, citedPinIds(next));
      if (v2.status === "CLEAN") {
        writeFileSync(REPORT, next);
        appendShip(v2, true);
        shipped = rebased = true;
        console.log(`REBASE: re-pinned on fresh facts; ${verdict.drifted.length} drift(s) disclosed as [was-pin:]`);
        console.log(`${ansi("1;32")}VERDICT: CLEAN${ansi("0")} — shipped re-based report.md (${v2.pin_hashes.length} pins revalidated)`);
      } else {
        console.log("REBASE: failed — world still moving");
        receipts.push(await announce(v2));
      }
    }
  }
  // Shipped contradiction (ground truth, not the gate's opinion): a shipped, non-re-based report that cites the
  // exact fact the injector changed.
  let contradiction = 0;
  if (shipped && !rebased && meta.injected) {
    const cdb = connect();
    const get = cdb.prepare("SELECT * FROM pins WHERE pin_id = ?");
    contradiction = citedPinIds(text).some((id) => {
      const p = get.get(id) as unknown as Pin | undefined;
      return !!p && p.source_url === meta.injected!.url && p.fact_text.startsWith(`${meta.injected!.field} of `);
    }) ? 1 : 0;
    cdb.close();
  }
  const writer = lastBuild.text === text ? lastBuild : { agent: "external", claims_kept: 0, claims_dropped: 0 };
  const run = {
    run_at: new Date().toISOString(), adapter: world.name,
    verdict: verdict.status === "CLEAN" ? "CLEAN" : "REFUSED", reason: verdict.status,
    mode: meta.mode, shipped, rebased, contradiction, gate_ms: verdict.gate_ms,
    agent: writer.agent, claims_kept: writer.claims_kept, claims_dropped: writer.claims_dropped,
    ...(meta.injected ? { injected: { ...meta.injected, factor: meta.injectedFactor ?? null } } : {}), checks: verdict.checks,
  };
  appendFileSync(RUNS, JSON.stringify(run) + "\n");
  // T3: stream this run to Tinybird as it happens (fire-and-forget, bounded wait; local files stay the truth).
  const db = connect();
  const session = sessionOf(db);
  const cited = citedPinIds(text).map((id) => db.prepare("SELECT pin_id, fetched_at FROM pins WHERE pin_id = ?").get(id) as { pin_id: string; fetched_at: string } | undefined);
  db.close();
  emit(eventsFor(session, cited.filter((c): c is { pin_id: string; fetched_at: string } => !!c), receipts.filter((r): r is NonNullable<typeof r> => !!r), [run]));
  await flush();
  return { verdict, shipped, rebased };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = getAdapter();
  const from = process.argv.indexOf("--from");
  const text = from > -1 ? readFileSync(process.argv[from + 1], "utf8") : await draft(a);
  const r = await decide(text, a, { mode: from > -1 ? "manual" : "live", rebase: process.argv.includes("--rebase") });
  process.exit(r.shipped ? 0 : 2);
}
