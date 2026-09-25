// The retail villain: 6pm fetch (pins) -> overnight reasoning -> 9pm competitor drops a price 15% -> 6am gate.
//   default  -> DRIFTED, REFUSED, receipt        --clean -> no drop, CLEAN, ships
// Clock labels are narrative; the run itself takes seconds.
import { getAdapter, pageUrls } from "./adapters.ts";
import { decide, draft } from "./ship.ts";
import { citedPriceTarget, PriceShift } from "./worlds.ts";
import { citedPinIds } from "./pins.ts";
const ansi = (c: string) => (process.stdout.isTTY ? `\x1b[${c}m` : ""); // color only on a terminal

const clean = process.argv.includes("--clean");
const say = (clock: string, msg: string) => console.log(`${ansi("1")}[${clock}]${ansi("0")} ${msg}`);
const base = getAdapter();

say("18:00 T0", `fetching ${pageUrls().length} competitor pages via ${base.name}; pinning every fact`);
const text = await draft(base);
say("overnight", `agent reasons over the pinned basis only → draft cites ${citedPinIds(text).length} pins, 0 URLs`);

const target = clean ? null : citedPriceTarget(text);
if (!clean && !target) { console.log("no cited price to drift — nothing passed ingest"); process.exit(1); }
const world = clean || !target ? base : new PriceShift(base, target, (p) => p * 0.85);
say("21:00 T1", clean
  ? (base.name === "mock" ? "competitor prices hold" : "nothing injected — any change from here on is the live page itself")
  : "competitor drops one price 15% (simulated) — the pipeline doesn't notice");

say("06:00 gate", "re-fetch → re-hash → compare, before anything ships");
// Ground truth: mock + no injection = clean. Live + no injection = unknown (the real world may move).
const live = base.name !== "mock";
const { verdict } = await decide(text, world, { mode: clean ? (live ? "live" : "clean") : "drift",
  ...(target ? { injected: { url: target, field: "price" } } : {}) });

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
}
process.exit(verdict.status === "CLEAN" ? 0 : 2);
