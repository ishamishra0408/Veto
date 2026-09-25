// Every [pin:...] in report.md must resolve to an untampered row in pins.db.
import { readFileSync } from "node:fs";
import { citedPinIds, connect, DB_PATH, resolve, supersededPinIds } from "./pins.ts";

const dbArg = process.argv.indexOf("--db");
const dbPath = dbArg > -1 ? process.argv[dbArg + 1] : DB_PATH;

const repArg = process.argv.indexOf("--report");
const text = readFileSync(repArg > -1 ? process.argv[repArg + 1] : new URL("./report.md", import.meta.url), "utf8");
const ids = [...citedPinIds(text), ...supersededPinIds(text)];
if (ids.length === 0) {
  console.log("MISSING (no pins cited)");
  process.exit(1);
}
const db = connect(dbPath);
let bad = 0;
for (const id of ids) {
  const ok = resolve(db, id);
  if (!ok) bad++;
  console.log(`${ok ? "OK     " : "MISSING"} ${id}`);
}
console.log(`${ids.length - bad}/${ids.length} resolved`);
process.exit(bad ? 1 : 0);
