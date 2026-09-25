// Content-addressed pin store: pin_id = sha256(canonical fact_text)[:12].
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { FetchResult } from "./adapters.ts";

export const DB_PATH = fileURLToPath(new URL("./pins.db", import.meta.url));
export const PIN_LEN = 12;
export const FIELDS = ["title", "price", "stock", "rating", "seller"] as const;
export type Field = (typeof FIELDS)[number];

export interface Pin {
  pin_id: string;
  fact_text: string;
  sha256: string;
  fetched_at: string;
  source_url: string;
}

export const canonical = (fact: string): string => fact.split(/\s+/).filter(Boolean).join(" ");
export const digest = (fact: string): string =>
  createHash("sha256").update(canonical(fact), "utf8").digest("hex");

export function connect(path: string = DB_PATH): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE IF NOT EXISTS pins (pin_id TEXT PRIMARY KEY, fact_text TEXT NOT NULL," +
      " sha256 TEXT NOT NULL, fetched_at TEXT NOT NULL, source_url TEXT NOT NULL)",
  );
  db.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  // Every sighting of a fact (a pin keeps its FIRST fetch time as identity; observations record each fetch).
  db.exec("CREATE TABLE IF NOT EXISTS observations (pin_id TEXT NOT NULL, observed_at TEXT NOT NULL, PRIMARY KEY (pin_id, observed_at))");
  // L1 status per pin: agreed (two extractors) | parser-only (second extractor unavailable).
  db.exec("CREATE TABLE IF NOT EXISTS corroboration (pin_id TEXT PRIMARY KEY, status TEXT NOT NULL)");
  db.prepare("INSERT OR IGNORE INTO meta VALUES ('session', ?)").run(randomUUID());
  return db;
}

export const sessionOf = (db: DatabaseSync): string =>
  (db.prepare("SELECT v FROM meta WHERE k = 'session'").get() as { v: string }).v;

// Fact text shape: "<field> of <url> is <value>". The URL lives in the pin, never the report.
export function factsFor(r: FetchResult): Record<Field, string> {
  return {
    title: `title of ${r.url} is ${r.title}`,
    price: `price of ${r.url} is ${r.price.toFixed(2)} USD`,
    stock: `stock of ${r.url} is ${r.stock}`,
    rating: `rating of ${r.url} is ${r.rating.toFixed(1)} out of 5`,
    seller: `seller of ${r.url} is ${r.seller}`,
  };
}

export const factValue = (p: Pin): string => p.fact_text.split(" is ").slice(1).join(" is ");

// One pin per fact. Same fact -> same pin; first fetch's timestamp wins (INSERT OR IGNORE).
export function pinResult(db: DatabaseSync, r: FetchResult): Record<Field, Pin> {
  const insert = db.prepare("INSERT OR IGNORE INTO pins VALUES (?,?,?,?,?)");
  const observe = db.prepare("INSERT OR IGNORE INTO observations VALUES (?,?)");
  const select = db.prepare("SELECT * FROM pins WHERE pin_id = ?");
  const facts = factsFor(r);
  const out = {} as Record<Field, Pin>;
  for (const field of FIELDS) {
    const text = canonical(facts[field]);
    const sha = digest(text);
    const pinId = sha.slice(0, PIN_LEN);
    insert.run(pinId, text, sha, r.fetched_at, r.url);
    observe.run(pinId, r.fetched_at);
    out[field] = select.get(pinId) as unknown as Pin;
  }
  return out;
}

// A pin resolves only if its row exists AND its fact_text still hashes to it.
export function resolve(db: DatabaseSync, pinId: string): boolean {
  const row = db.prepare("SELECT fact_text, sha256 FROM pins WHERE pin_id = ?").get(pinId) as
    | { fact_text: string; sha256: string }
    | undefined;
  if (!row) return false;
  const sha = digest(row.fact_text);
  return sha === row.sha256 && sha.startsWith(pinId);
}

// Parse "<field> of <url> is <value>" back into parts (gate needs field + url to re-fetch).
export function parseFact(fact: string): { field: Field; url: string; value: string } {
  const m = /^(\w+) of (\S+) is (.*)$/.exec(fact);
  if (!m || !(FIELDS as readonly string[]).includes(m[1])) throw new Error(`unparseable fact: ${fact}`);
  return { field: m[1] as Field, url: m[2], value: m[3] };
}

export const citedPinIds = (text: string): string[] =>
  [...new Set([...text.matchAll(/\[pin:([0-9a-f]+)\]/g)].map((m) => m[1]))];

// Superseded facts disclosed after a re-base: must still resolve, but are not revalidated.
export const supersededPinIds = (text: string): string[] =>
  [...new Set([...text.matchAll(/\[was-pin:([0-9a-f]+)\]/g)].map((m) => m[1]))];

// Rebuild a page's FetchResult from its pinned facts (used by a targeted re-base for pages that did not drift).
export function resultFromPins(db: DatabaseSync, url: string, pinIds: string[]): FetchResult | null {
  const get = db.prepare("SELECT * FROM pins WHERE pin_id = ?");
  const ps = pinIds.map((id) => get.get(id) as unknown as Pin | undefined).filter((p): p is Pin => !!p && p.source_url === url);
  const f = Object.fromEntries(ps.map((p) => { const x = parseFact(p.fact_text); return [x.field, x.value]; })) as Record<string, string>;
  if (!FIELDS.every((k) => k in f)) return null;
  const seen = (db.prepare(`SELECT MAX(observed_at) AS t FROM observations WHERE pin_id IN (${ps.map(() => "?").join(",")})`).get(...ps.map((p) => p.pin_id)) as { t: string | null }).t;
  return { url, title: f.title, price: parseFloat(f.price), stock: f.stock, rating: parseFloat(f.rating), seller: f.seller, fetched_at: seen ?? ps[0].fetched_at };
}
