// World-change injectors. They wrap ANY adapter (mock or Nimble), so the same drift runs on live data.
import { FetchAdapter, type FetchResult } from "./adapters.ts";

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
  async fetch(url: string): Promise<FetchResult> {
    throw new Error(`simulated outage fetching ${url}`);
  }
}
