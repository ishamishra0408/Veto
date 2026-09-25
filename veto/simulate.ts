// T0: honest fetch -> pins -> draft. T1: world changes (or not). Gate decides whether the draft ships.
//   --clean   world unchanged           -> CLEAN, report.md written
//   --drift   one fixture price flipped -> DRIFTED, REFUSED, receipt   (+ --rebase: re-pin, disclose, ship)
//   --outage  fetch raises              -> UNREACHABLE, REFUSED (fail closed), receipt
import { getAdapter, pageUrls } from "./adapters.ts";
import { decide, draft } from "./ship.ts";
import { citedPriceTarget, Outage, PriceShift } from "./worlds.ts";

const mode = process.argv[2] ?? "--clean";
if (!["--clean", "--drift", "--outage"].includes(mode)) {
  console.error("usage: simulate.ts --clean | --drift [--rebase] | --outage");
  process.exit(64);
}
const base = getAdapter();
const text = await draft(base);
const target = mode === "--drift" ? (citedPriceTarget(text, 0) ?? pageUrls()[0]) : null;
const world = mode === "--drift" ? new PriceShift(base, target!, (p) => p - 20)
  : mode === "--outage" ? new Outage(base) : base;
const r = await decide(text, world, { mode: mode.slice(2), rebase: process.argv.includes("--rebase"),
  ...(target ? { injected: { url: target, field: "price" } } : {}) });
process.exit(r.shipped ? 0 : 2);
