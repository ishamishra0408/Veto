// Fetch seam. Nothing outside this file names a concrete adapter; use getAdapter().
import { appendFileSync, readFileSync } from "node:fs";

const FIXTURES = new URL("./pages.txt", import.meta.url);

export interface FetchResult {
  url: string;
  title: string;
  price: number; // USD
  stock: string;
  rating: number; // out of 5
  seller: string;
  fetched_at: string; // ISO-8601 UTC, stamped at fetch time
}

export abstract class FetchAdapter {
  abstract readonly name: string;
  abstract fetch(url: string): Promise<FetchResult>;
  // Raw page text from the last fetch of `url`, when the adapter has one (used only at ingest, for L1).
  raw(_url: string): string | undefined { return undefined; }
  // Find replacement listings for a query (Nimble: nimble_search). Adapters without search return [].
  async search(_query: string): Promise<string[]> { return []; }
}

type Fixture = Omit<FetchResult, "url" | "fetched_at">;

const dataLines = (file: URL) =>
  readFileSync(file, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#"));

function loadFixtures(): Map<string, Fixture> {
  const rows = new Map<string, Fixture>();
  for (const line of dataLines(FIXTURES).map((l) => l.replace(/^\+/, ""))) {
    const [url, title, price, stock, rating, seller] = line.split("|").map((p) => p.trim());
    rows.set(url, { title, price: Number(price), stock, rating: Number(rating), seller });
  }
  return rows;
}

class MockAdapter extends FetchAdapter {
  readonly name = "mock";
  private fixtures = loadFixtures();

  async search(_query: string): Promise<string[]> {
    return dataLines(FIXTURES).filter((l) => l.startsWith("+")).map((l) => l.slice(1).split("|")[0].trim());
  }

  // Deterministic fixtures from pages.txt; only fetched_at varies.
  async fetch(url: string): Promise<FetchResult> {
    const f = this.fixtures.get(url);
    if (!f) throw new Error(`no fixture for ${url}`);
    return { url, ...f, fetched_at: new Date().toISOString() };
  }
}

// ---------- Nimble MCP (streamable HTTP, JSON-RPC 2.0) ----------

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const trace = (msg: string) => process.stderr.write(`\x1b[36m[nimble mcp]\x1b[0m ${msg}\n`);
const short = (t: string) => t.split(/[,(]| - /)[0].trim().split(/\s+/).slice(0, 4).join(" "); // display only
// G1: every MCP request is also persisted, one JSON line each (committed as evidence for a live run).
export const MCP_TRACE = new URL("./mcp-trace.jsonl", import.meta.url);
const persist = (row: Record<string, unknown>) => { try { appendFileSync(MCP_TRACE, JSON.stringify(row) + "\n"); } catch { /* never block a fetch */ } };

const FIELD_KEYS: Record<Exclude<keyof FetchResult, "url" | "fetched_at">, string[]> = {
  title: ["title", "product_title", "product_name", "name"],
  price: ["price", "current_price", "sale_price", "offer_price", "final_price"],
  stock: ["availability", "stock_status", "stock", "in_stock", "inventory_status"],
  rating: ["rating", "average_rating", "rating_value", "stars"],
  seller: ["seller", "sold_by", "seller_name", "merchant", "retailer"],
};

function findKey(node: Json, keys: string[], depth = 0): Json {
  if (!node || typeof node !== "object" || depth > 8) return undefined;
  for (const k of keys) {
    const v = node[k];
    if (v !== undefined && v !== null && v !== "") return typeof v === "object" && !Array.isArray(v) ? (v.value ?? v.name ?? v.amount) : v;
  }
  for (const v of Object.values(node)) {
    const hit = findKey(v, keys, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

// Canonical extracted values: the same fact must hash the same wherever on the page it was read.
export const clean = (v: string) =>
  v.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links -> text
    .replace(/\\([\\`*_{}\[\]()#+\-.!|])/g, "$1") // markdown escapes ("GLAM\_AZON" -> "GLAM_AZON")
    .replace(/https?:\/\/\S+/g, "") // bare URLs never enter a fact
    .replace(/\s+and (ships|fulfilled) (from|by) .*$/i, "")
    .replace(/^ships from and sold by\s+/i, "")
    .replace(/[\s.]+$/, "")
    .trim();
export const canonStock = (v: string) =>
  /out of stock|unavailable|sold out/i.test(v) ? "Out of stock" : /(only )?\d+ left|low stock/i.test(v) ? "Low stock" : /in stock/i.test(v) ? "In stock" : clean(v);

// Map a Nimble tools/call result onto FetchResult. Missing field -> throw (fail closed); never invent a value.
export function markdownOf(result: Json): string {
  const texts: string[] = (result?.content ?? []).filter((c: Json) => c?.type === "text").map((c: Json) => c.text);
  const docs: Json[] = [];
  for (const t of texts) try { docs.push(JSON.parse(t)); } catch { /* plain text */ }
  return docs.map((d) => (typeof d?.content === "string" ? d.content : "")).join("\n") || texts.join("\n");
}

export function toFetchResult(url: string, result: Json, fetched_at: string): FetchResult {
  const texts: string[] = (result?.content ?? []).filter((c: Json) => c?.type === "text").map((c: Json) => c.text);
  const docs: Json[] = [result?.structuredContent];
  for (const t of texts) try { docs.push(JSON.parse(t)); } catch { /* markdown/plain text */ }
  const md = docs.map((d) => (typeof d?.content === "string" ? d.content : "")).join("\n") || texts.join("\n");
  const pick = (f: keyof typeof FIELD_KEYS) => docs.map((d) => findKey(d, FIELD_KEYS[f])).find((v) => v !== undefined);

  const num = (v: Json) => (v === undefined ? NaN : Number(String(v).replace(/[^0-9.]/g, "")));
  const title = pick("title") ?? /^#\s+(.+)$/m.exec(md)?.[1];
  const price = num(pick("price") ?? (/Buy New\s+\$\s?([\d,]+\.\d{2})/.exec(md) ?? /\|\s*Price\s*\|[^$\n]*\$\s?([\d,]+\.\d{2})/.exec(md))?.[1]);
  let stock = pick("stock") ?? /\b(only \d+ left|in stock|out of stock|currently unavailable|sold out|low stock)\b/i.exec(md)?.[1];
  if (typeof stock === "boolean") stock = stock ? "In stock" : "Out of stock";
  const rating = num(pick("rating") ?? /([0-5](?:\.\d)?)\s*out of 5/i.exec(md)?.[1]);
  const seller = pick("seller") ?? /sold by:?\s+([^\n|]+)/i.exec(md)?.[1];

  const missing = Object.entries({ title, price, stock, rating, seller })
    .filter(([, v]) => v === undefined || (typeof v === "number" && Number.isNaN(v)))
    .map(([k]) => k);
  if (missing.length) throw new Error(`Nimble extract for ${url} is missing ${missing.join(", ")} — refusing to invent`);
  return { url, title: clean(String(title)), price, stock: canonStock(String(stock)), rating, seller: clean(String(seller)), fetched_at };
}

class NimbleMCPAdapter extends FetchAdapter {
  readonly name = "nimble-mcp";
  private endpoint = process.env.NIMBLE_MCP_URL ?? "https://mcp.nimbleway.com/mcp";
  private session: string | null = null;
  private ready: Promise<string> | null = null;
  private seq = 0;
  private rawByUrl = new Map<string, string>();

  raw(url: string): string | undefined { return this.rawByUrl.get(url); }

  private key(): string {
    const k = process.env.NIMBLE_API_KEY;
    if (!k) throw new Error("NIMBLE_API_KEY is not set. Get one at Nimble → Account Settings → API Keys, then export it. No key is ever invented.");
    return k;
  }

  private async rpc(method: string, params?: Json, notify = false): Promise<Json> {
    const body: Json = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++this.seq, method, params };
    const ts = new Date().toISOString(), t0 = Date.now();
    const row = { ts, method, ...(params?.name ? { tool: params.name } : {}), ...(params?.arguments?.url ? { url: params.arguments.url } : {}) };
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${this.key()}`,
        ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.NIMBLE_TIMEOUT_MS ?? 90_000)),
      });
    } catch (e) {
      persist({ ...row, ms: Date.now() - t0, error: (e as Error).message.slice(0, 120) });
      throw e;
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    const text = await res.text();
    persist({ ...row, ms: Date.now() - t0, http: res.status }); // timed to the full body, not just headers
    if (!res.ok) throw new Error(`MCP ${method} → HTTP ${res.status}: ${text.slice(0, 200)}`);
    if (notify) return null;
    const msgs: Json[] = (res.headers.get("content-type") ?? "").includes("text/event-stream")
      ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5).trim()))
      : [JSON.parse(text)];
    const msg = msgs.find((m) => m.id === body.id);
    if (!msg) throw new Error(`MCP ${method}: no response for id ${body.id}`);
    if (msg.error) throw new Error(`MCP ${method} error ${msg.error.code}: ${msg.error.message}`);
    return msg.result;
  }

  private async init(): Promise<string> {
    trace(`connect ${this.endpoint}`);
    const info = await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pinned-evidence-veto", version: "0.1.0" },
    });
    await this.rpc("notifications/initialized", {}, true);
    trace(`session ${this.session ? "✓" : "(stateless)"} · ${info?.serverInfo?.name ?? "server"} ${info?.serverInfo?.version ?? ""}`.trimEnd());
    const { tools } = await this.rpc("tools/list", {});
    const names: string[] = tools.map((t: Json) => t.name);
    trace(`tools/list → ${names.length} tools (Veto uses nimble_extract, nimble_search)`);
    const want = process.env.NIMBLE_EXTRACT_TOOL ?? "nimble_extract";
    if (!names.includes(want)) throw new Error(`Nimble MCP has no tool "${want}" (set NIMBLE_EXTRACT_TOOL). Available: ${names.join(", ")}`);
    return want;
  }

  async search(query: string): Promise<string[]> {
    await (this.ready ??= this.init());
    const t0 = Date.now();
    trace(`tools/call nimble_search "${query}" (amazon.com, lite)`);
    const result = await this.rpc("tools/call", { name: "nimble_search", arguments: {
      query, max_results: 20, include_domains: ["amazon.com"], search_depth: "lite", country: "US", locale: "en" } });
    const text: string = (result?.content ?? []).map((c: Json) => c.text ?? "").join("\n");
    const urls = [...text.matchAll(/https?:\/\/www\.amazon\.com\/(?:[^\s"]*?\/)?(?:dp|clp|gp\/product)\/([A-Z0-9]{10})/g)].map((m) => `https://www.amazon.com/dp/${m[1]}`);
    const unique = [...new Set(urls)];
    trace(`  ← ${Date.now() - t0}ms · ${unique.length} product listing(s)`);
    return unique;
  }

  async fetch(url: string): Promise<FetchResult> {
    const tool = await (this.ready ??= this.init());
    const args = {
      url, output_format: "markdown", country: "US", locale: "en",
      context: "Veto fetches a retail product page to pin price facts before revalidating a pricing report for drift.",
      ...JSON.parse(process.env.NIMBLE_EXTRACT_ARGS ?? "{}"),
    };
    const t0 = Date.now();
    trace(`tools/call ${tool} ${url.replace(/^https?:\/\/(www\.)?/, "")}`);
    const result = await this.rpc("tools/call", { name: tool, arguments: args });
    if (result?.isError) throw new Error(`${tool} failed for ${url}: ${JSON.stringify(result.content).slice(0, 200)}`);
    const r = toFetchResult(url, result, new Date().toISOString());
    this.rawByUrl.set(url, markdownOf(result));
    trace(`  ← ${Date.now() - t0}ms · ${short(r.title)} · $${r.price.toFixed(2)} · ${r.stock}`);
    return r;
  }
}

// Page list: VETO_PAGES (default pages.txt). First column is the URL.
// Optional search hint per watched page (2nd column in pages.real.txt; title column in the mock fixtures).
export function pageHint(url: string, file = process.env.VETO_PAGES ?? "pages.txt"): string | undefined {
  const line = dataLines(new URL(`./${file}`, import.meta.url)).find((l) => l.split("|")[0].trim() === url);
  return line?.split("|")[1]?.trim() || undefined;
}

export function pageUrls(file = process.env.VETO_PAGES ?? "pages.txt"): string[] {
  const urls = dataLines(new URL(`./${file}`, import.meta.url)).filter((l) => !l.startsWith("+")).map((l) => l.split("|")[0].trim());
  if (!urls.length) throw new Error(`${file} lists no URLs`);
  return urls;
}

export function getAdapter(kind = process.env.VETO_ADAPTER ?? "mock"): FetchAdapter {
  if (kind === "mock") return new MockAdapter();
  if (kind === "nimble") return new NimbleMCPAdapter();
  throw new Error(`unknown VETO_ADAPTER: ${kind}`);
}

// The retailer that hosts a page (its own listings are first-party; anyone else is a third-party seller).
export const retailerOf = (url: string) => (/amazon\./.test(url) ? "Amazon.com" : /bestbuy\./.test(url) ? "Best Buy" : new URL(url).hostname);
