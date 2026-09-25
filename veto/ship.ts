// The only path that writes report.md: draft -> gate -> ship on CLEAN, else receipt (+ optional re-base).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getAdapter, type FetchAdapter } from "./adapters.ts";
import { revalidate, type Drift, type Verdict } from "./gate.ts";
import { citedPinIds, connect, DB_PATH, factsFor, factValue, parseFact, PIN_LEN, resultFromPins, sessionOf, type Pin } from "./pins.ts";
import { checkClaims, shortName, type BasisFact } from "./agent.ts";
import { appendReceipt, appendShip } from "./receipts.ts";
import { emit, eventsFor, flush } from "./stream.ts";
import { buildReport, DRAFT, lastBuild, REPORT, type BuildOpts } from "./report.ts";
const ansi = (c: string) => (process.stdout.isTTY ? `\x1b[${c}m` : ""); // color only on a terminal

export const RUNS = new URL("./runs.jsonl", import.meta.url);

export interface RunMeta {
  mode: string; // clean | drift | outage | live — ground truth of the injected world
  rebase?: boolean;
  injected?: { url: string; field: string }; // the fact the injector changed (ground truth for contradictions)
  injectedFactor?: number; // e.g. 0.85 for the villain's −15%
  onRefused?: (v: Verdict) => void; // planner hook: observe + impact analysis, before any self-correction
}

export async function draft(adapter: FetchAdapter, disclosures: Drift[] = [], opts: BuildOpts = {}): Promise<string> {
  const db = connect();
  const text = await buildReport(adapter, db, disclosures, opts);
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

// F: after a refusal, one confirming fetch of the drifted pages classifies each change:
//   moved   — the new value holds (a real change)      flap — the pinned value is back (an unstable source)
//   moving  — a third value                             unknown — the page could not be re-read
// A refusal whose every drift is a flap is counted as a FALSE refusal (the counter metric, now falsifiable live).
async function confirmDrifts(world: FetchAdapter, v: Extract<Verdict, { status: "DRIFTED" }>) {
  const urls = [...new Set(v.drifted.map((d) => d.source_url))];
  const got = new Map((await Promise.allSettled(urls.map((u) => world.fetch(u)))).map((x, i) => [urls[i], x.status === "fulfilled" ? x.value : null]));
  return v.drifted.map((d) => {
    const r = got.get(d.source_url);
    const now = r ? parseFact(factsFor(r)[d.field]).value : null;
    const cls = now === null ? "unknown" : now === d.old_value ? "flap" : now === d.new_value ? "moved" : "moving";
    return { pin_id: d.pin_id, field: d.field, confirm_value: now, class: cls };
  });
}

async function announce(v: Verdict, confirm: Awaited<ReturnType<typeof confirmDrifts>> = []) {
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
  const receipt = { ...appendReceipt(v, why?.kept ?? [], confirm) };
  console.log(`${ansi("1;31")}VERDICT: REFUSED (${v.status})${ansi("0")} — report.md not written`);
  if (v.status === "DRIFTED")
    for (const d of v.drifted) console.log(`  drift [pin:${d.pin_id}] ${d.field}: ${d.old_value} -> ${d.new_value}`);
  else console.log(`  ${v.error}`);
  for (const w of why?.kept ?? []) console.log(`  ${ansi("1")}WHY:${ansi("0")} ${w}`);
  if (confirm.length) console.log(`  confirm fetch: ${confirm.map((c) => `${c.field} ${c.class}`).join(", ")}`);
  console.log(`RECEIPT: ${JSON.stringify(receipt)}`);
  return receipt;
}

export async function decide(text: string, world: FetchAdapter, meta: RunMeta) {
  const writer0 = lastBuild.text === text ? { ...lastBuild } : { agent: "external", claims_kept: 0, claims_dropped: 0 };
  const verdict = await revalidate(DB_PATH, world, citedPinIds(text));
  let confirm: Awaited<ReturnType<typeof confirmDrifts>> = [];
  let finalGate: Verdict | null = null, rebaseFetched = 0, rebaseWriter: typeof writer0 | null = null;
  let shipped = false, rebased = false;
  const receipts: (ReturnType<typeof appendReceipt> | null)[] = [];
  if (verdict.status === "CLEAN") {
    writeFileSync(REPORT, text);
    appendShip(verdict);
    shipped = true;
    console.log(`${ansi("1;32")}VERDICT: CLEAN${ansi("0")} — shipped report.md (${verdict.pin_hashes.length} pins revalidated)`);
  } else {
    if (verdict.status === "DRIFTED") confirm = await confirmDrifts(world, verdict);
    receipts.push(await announce(verdict, confirm));
    meta.onRefused?.(verdict);
    if (meta.rebase && verdict.status === "DRIFTED") {
      // Self-correct: re-pin on fresh facts and re-gate. A listing that keeps moving gets a second try, then refusal.
      let drifts = verdict.drifted, basisText = text;
      // Facts that flapped on the confirm fetch, or move again during a re-pin, are unstable: the re-plan stops
      // relying on them (shown without a pin) instead of chasing a value that won't hold still.
      const unstable = new Set(confirm.filter((c) => c.class === "flap").map((c) => `${verdict.drifted.find((d) => d.pin_id === c.pin_id)!.source_url}|${c.field}`));
      for (let attempt = 1; attempt <= 3 && !shipped; attempt++) {
        // G: targeted re-base — re-fetch only the pages that drifted; every other page is rebuilt from its pins.
        const rdb = connect();
        const cited = citedPinIds(basisText);
        const urlsInDraft = [...new Set(cited.map((id) => (rdb.prepare("SELECT source_url FROM pins WHERE pin_id = ?").get(id) as { source_url: string } | undefined)?.source_url).filter((u): u is string => !!u))];
        const driftedUrls = new Set(drifts.map((d) => d.source_url));
        const reuse = new Map(urlsInDraft.filter((u) => !driftedUrls.has(u)).map((u) => [u, resultFromPins(rdb, u, cited)] as const)
          .filter((e): e is readonly [string, NonNullable<ReturnType<typeof resultFromPins>>] => !!e[1]));
        rdb.close();
        const next = await draft(world, drifts, { urls: urlsInDraft, reuse, replace: false, unstable });
        rebaseFetched += urlsInDraft.length - reuse.size;
        rebaseWriter = { ...lastBuild };
        basisText = next;
        const v2 = await revalidate(DB_PATH, world, citedPinIds(next));
        finalGate = v2;
        if (v2.status === "CLEAN") {
          writeFileSync(REPORT, next);
          appendShip(v2, true);
          shipped = rebased = true;
          console.log(`REBASE: re-fetched ${urlsInDraft.length - reuse.size} drifted page(s), reused ${reuse.size} from their pins${attempt > 1 ? ` (attempt ${attempt})` : ""}; ${verdict.drifted.length} drift(s) disclosed as [was-pin:]${unstable.size ? `; ${unstable.size} unstable fact(s) not relied on` : ""}`);
          console.log(`${ansi("1;32")}VERDICT: CLEAN${ansi("0")} — shipped re-based report.md (${v2.pin_hashes.length} pins revalidated)`);
        } else {
          console.log(`REBASE: attempt ${attempt} — ${v2.status === "DRIFTED" ? "the page moved again during re-pin" : "re-gate refused"}`);
          if (attempt === 3 || v2.status !== "DRIFTED") { receipts.push(await announce(v2)); break; }
          for (const d of v2.drifted) unstable.add(`${d.source_url}|${d.field}`);
          console.log(`REBASE: ${v2.drifted.map((d) => d.field).join(", ")} moved again → marked unstable; re-planning without relying on ${v2.drifted.length === 1 ? "it" : "them"}`);
          drifts = [...verdict.drifted, ...v2.drifted];
        }
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
  const writer = writer0;
  const falseRefusal = confirm.length > 0 && confirm.every((c) => c.class === "flap") ? 1 : 0;
  const run = {
    run_at: new Date().toISOString(), adapter: world.name,
    verdict: verdict.status === "CLEAN" ? "CLEAN" : "REFUSED", reason: verdict.status,
    mode: meta.mode, shipped, rebased, contradiction, gate_ms: verdict.gate_ms,
    agent: writer.agent, claims_kept: writer.claims_kept, claims_dropped: writer.claims_dropped,
    false_refusal: falseRefusal, drift_classes: confirm.map((c) => c.class),
    ...(finalGate ? { final_verdict: finalGate.status, final_gate_ms: finalGate.gate_ms, rebase_fetched: rebaseFetched,
      rebase_agent: rebaseWriter?.agent, rebase_claims_kept: rebaseWriter?.claims_kept, rebase_claims_dropped: rebaseWriter?.claims_dropped } : {}),
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
