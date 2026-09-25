// T0: honest fetch -> pins -> draft. T1: world changes (or not). Gate decides whether the draft ships.
//   --clean   world unchanged           -> CLEAN, report.md written
//   --drift   one fixture price flipped -> DRIFTED, REFUSED, receipt   (+ --rebase: re-pin, disclose, ship)
//   --outage  fetch raises              -> UNREACHABLE, REFUSED (fail closed), receipt
import { getAdapter, pageUrls } from "./adapters.ts";
import { decide, draft } from "./ship.ts";
import { Outage, PriceShift } from "./worlds.ts";

const mode = process.argv[2] ?? "--clean";
if (!["--clean", "--drift", "--outage"].includes(mode)) {
  console.error("usage: simulate.ts --clean | --drift [--rebase] | --outage");
  process.exit(64);
}
const base = getAdapter();
const text = await draft(base);
const world = mode === "--drift" ? new PriceShift(base, pageUrls()[0], (p) => p - 20)
  : mode === "--outage" ? new Outage(base) : base;
const r = await decide(text, world, { mode: mode.slice(2), rebase: process.argv.includes("--rebase") });
process.exit(r.shipped ? 0 : 2);
