// Deterministic revalidation gate: re-fetch -> re-hash -> compare. Pure: reads pins, never writes.
// Fail closed: any fetch error, missing pin, or empty basis refuses the ship.
import { DatabaseSync } from "node:sqlite";
import type { FetchAdapter, FetchResult } from "./adapters.ts";
import { digest, factsFor, parseFact, type Field, type Pin } from "./pins.ts";

export interface Drift {
  pin_id: string;
  source_url: string;
  field: Field;
  old_hash: string;
  new_hash: string;
  old_value: string;
  new_value: string;
}

interface Basis {
  pin_hashes: string[];
  basis_window: { from: string; to: string } | null;
  checked_at: string;
}

export type Verdict =
  | ({ status: "CLEAN"; ship: true } & Basis)
  | ({ status: "DRIFTED"; ship: false; drifted: Drift[] } & Basis)
  | ({ status: "UNREACHABLE"; ship: false; error: string } & Basis);

export async function revalidate(dbPath: string, adapter: FetchAdapter, basisPinIds: string[]): Promise<Verdict> {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const get = db.prepare("SELECT * FROM pins WHERE pin_id = ?");
  const pins = basisPinIds.map((id) => get.get(id) as unknown as Pin | undefined);
  db.close();

  const found = pins.filter((p): p is Pin => p !== undefined);
  const stamps = found.map((p) => p.fetched_at).sort();
  const basis = (): Basis => ({
    pin_hashes: found.map((p) => p.sha256),
    basis_window: stamps.length ? { from: stamps[0], to: stamps[stamps.length - 1] } : null,
    checked_at: new Date().toISOString(),
  });
  const refuse = (error: string): Verdict => ({ status: "UNREACHABLE", ship: false, error, ...basis() });

  if (basisPinIds.length === 0) return refuse("empty basis: nothing cited, nothing to revalidate");
  if (found.length !== pins.length) return refuse("basis cites a pin absent from the vault");

  // Re-fetch every source concurrently. Any failure refuses the ship (fail closed), reported in page order.
  const urls = [...new Set(found.map((p) => parseFact(p.fact_text).url))];
  const settled = await Promise.allSettled(urls.map((u) => adapter.fetch(u)));
  const fresh = new Map<string, FetchResult>();
  for (let i = 0; i < urls.length; i++) {
    const s = settled[i];
    if (s.status === "rejected") return refuse(`fetch failed for ${urls[i]}: ${(s.reason as Error).message}`);
    fresh.set(urls[i], s.value);
  }
  const drifted: Drift[] = [];
  for (const pin of found) {
    const { field, url, value } = parseFact(pin.fact_text);
    const newFact = factsFor(fresh.get(url)!)[field];
    const newHash = digest(newFact);
    if (newHash !== pin.sha256) {
      drifted.push({ pin_id: pin.pin_id, source_url: url, field, old_hash: pin.sha256, new_hash: newHash,
        old_value: value, new_value: parseFact(newFact).value });
    }
  }
  return drifted.length
    ? { status: "DRIFTED", ship: false, drifted, ...basis() }
    : { status: "CLEAN", ship: true, ...basis() };
}
