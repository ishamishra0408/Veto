// World-change injectors. They wrap ANY adapter (mock or Nimble), so the same drift runs on live data.
import { FetchAdapter, type FetchResult } from "./adapters.ts";
import { citedPinIds, connect, parseFact, type Pin } from "./pins.ts";

export class PriceShift extends FetchAdapter {
  private inner: FetchAdapter;
  private url: string;
  private shift: (price: number) => number;
  constructor(inner: FetchAdapter, url: string, shift: (price: number) => number) {
    super();
    this.inner = inner;
    this.url = url;
    this.shift = shift;
  }
  get name() { return this.inner.name; }
  raw(url: string) { return this.inner.raw(url); }
  async fetch(url: string): Promise<FetchResult> {
    const r = await this.inner.fetch(url);
    return url === this.url ? { ...r, price: Math.round(this.shift(r.price) * 100) / 100 } : r;
  }
}

export class Outage extends FetchAdapter {
  private inner: FetchAdapter;
  constructor(inner: FetchAdapter) {
    super();
    this.inner = inner;
  }
  get name() { return this.inner.name; }
  raw(url: string) { return this.inner.raw(url); }
  async fetch(url: string): Promise<FetchResult> {
    throw new Error(`simulated outage fetching ${url}`);
  }
}

// Aim an injected drift at a fact the draft actually cites (a page held at ingest is not in the basis).
export function citedPriceTarget(text: string, prefer = 1): string | null {
  const db = connect();
  const get = db.prepare("SELECT * FROM pins WHERE pin_id = ?");
  const urls = citedPinIds(text).map((id) => get.get(id) as unknown as Pin | undefined)
    .filter((p): p is Pin => !!p && parseFact(p.fact_text).field === "price").map((p) => p.source_url);
  db.close();
  return urls[prefer] ?? urls[0] ?? null;
}
