// The only path that writes report.md: draft -> gate -> ship on CLEAN, else receipt (+ optional re-base).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getAdapter, type FetchAdapter } from "./adapters.ts";
import { revalidate, type Drift, type Verdict } from "./gate.ts";
import { citedPinIds, connect, DB_PATH } from "./pins.ts";
import { appendReceipt } from "./receipts.ts";
import { buildReport, DRAFT, REPORT } from "./report.ts";
const ansi = (c: string) => (process.stdout.isTTY ? `\x1b[${c}m` : ""); // color only on a terminal

export const RUNS = new URL("./runs.jsonl", import.meta.url);

export interface RunMeta {
  mode: string; // clean | drift | outage | live — ground truth of the injected world
  rebase?: boolean;
}

export async function draft(adapter: FetchAdapter, disclosures: Drift[] = []): Promise<string> {
  const db = connect();
  const text = await buildReport(adapter, db, disclosures);
  db.close();
  writeFileSync(DRAFT, text);
  return text;
}

function announce(v: Verdict) {
  if (v.status === "CLEAN") return;
  const receipt = appendReceipt(v);
  console.log(`${ansi("1;31")}VERDICT: REFUSED (${v.status})${ansi("0")} — report.md not written`);
  if (v.status === "DRIFTED")
    for (const d of v.drifted) console.log(`  drift [pin:${d.pin_id}] ${d.field}: ${d.old_value} -> ${d.new_value}`);
  else console.log(`  ${v.error}`);
  console.log(`RECEIPT: ${JSON.stringify(receipt)}`);
}

export async function decide(text: string, world: FetchAdapter, meta: RunMeta) {
  const verdict = await revalidate(DB_PATH, world, citedPinIds(text));
  let shipped = false, rebased = false;
  if (verdict.status === "CLEAN") {
    writeFileSync(REPORT, text);
    shipped = true;
    console.log(`${ansi("1;32")}VERDICT: CLEAN${ansi("0")} — shipped report.md (${verdict.pin_hashes.length} pins revalidated)`);
  } else {
    announce(verdict);
    if (meta.rebase && verdict.status === "DRIFTED") {
      const next = await draft(world, verdict.drifted);
      const v2 = await revalidate(DB_PATH, world, citedPinIds(next));
      if (v2.status === "CLEAN") {
        writeFileSync(REPORT, next);
        shipped = rebased = true;
        console.log(`REBASE: re-pinned on fresh facts; ${verdict.drifted.length} drift(s) disclosed as [was-pin:]`);
        console.log(`${ansi("1;32")}VERDICT: CLEAN${ansi("0")} — shipped re-based report.md (${v2.pin_hashes.length} pins revalidated)`);
      } else {
        console.log("REBASE: failed — world still moving");
        announce(v2);
      }
    }
  }
  appendFileSync(RUNS, JSON.stringify({
    run_at: new Date().toISOString(), adapter: world.name,
    verdict: verdict.status === "CLEAN" ? "CLEAN" : "REFUSED", reason: verdict.status,
    mode: meta.mode, shipped, rebased,
  }) + "\n");
  return { verdict, shipped, rebased };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = getAdapter();
  const from = process.argv.indexOf("--from");
  const text = from > -1 ? readFileSync(process.argv[from + 1], "utf8") : await draft(a);
  const r = await decide(text, a, { mode: from > -1 ? "manual" : "live", rebase: process.argv.includes("--rebase") });
  process.exit(r.shipped ? 0 : 2);
}
