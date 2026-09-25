// L1 — two independent extractors must agree before a fact is pinned.
// Extractor A: the deterministic parser in adapters.ts. Extractor B: Liquid reading the same raw Nimble page.
// Runs at INGEST only (report.ts). The gate never calls this: revalidation stays model-free (R7).
import { canonStock, clean, type FetchResult } from "./adapters.ts";
import { EXTRACT_MODEL, LIQUID_WHERE, liquidChat } from "./liquid.ts";

export interface Extracted { title?: string; price?: number; stock?: string; rating?: number; seller?: string }
export type Extractor = (snippet: string) => Promise<Extracted>;
export interface Corroboration { status: "agreed" | "held" | "unavailable"; mismatches: string[]; detail: string }

const trace = (msg: string) => process.stderr.write(`\x1b[35m[liquid extract]\x1b[0m ${msg}\n`);
const short = (t: string) => t.split(/[,(]| - /)[0].trim().split(/\s+/).slice(0, 4).join(" "); // display only
const modelName = () => EXTRACT_MODEL.replace(/^hf\.co\/LiquidAI\//, "").replace(/-GGUF:.*$/, "");

// The model gets the lines around the product facts, not 170k chars of page chrome.
export function snippetOf(md: string): string {
  const lines = md.split("\n");
  const anchors = [/^# /, /Buy New/, /out of 5 stars/i, /sold by/i, /\b(in stock|only \d+ left|out of stock|currently unavailable)\b/i];
  const keep = new Set<number>();
  for (const a of anchors) {
    const i = lines.findIndex((l) => a.test(l));
    if (i > -1) for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 4); j++) keep.add(j);
  }
  return [...keep].sort((a, b) => a - b).map((i) => lines[i].replace(/\(https?:[^)]*\)/g, "")).join("\n").slice(0, 4000);
}

export const liquidExtract: Extractor = async (snippet) => {
  const text = await liquidChat(
    "Extract the MAIN product's facts from this product page excerpt. Reply with ONE JSON object and nothing else: " +
    '{"title": string, "price": number (the buy price, USD, no symbol), "stock": string, "rating": number (out of 5), "seller": string}.',
    snippet, 1500, EXTRACT_MODEL);
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error("no JSON in model reply");
  return JSON.parse(m[0]) as Extracted;
};

const norm = (v: string) => clean(v).toLowerCase().replace(/[^a-z0-9]/g, "");
const tokens = (v: string) => new Set(clean(v).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1));

export function agree(r: FetchResult, m: Extracted): string[] {
  const out: string[] = [];
  if (typeof m.price !== "number" || Math.abs(m.price - r.price) > 0.005) out.push(`price ${r.price.toFixed(2)} ≠ ${m.price}`);
  if (typeof m.rating !== "number" || Math.abs(m.rating - r.rating) > 0.05) out.push(`rating ${r.rating} ≠ ${m.rating}`);
  if (!m.stock || canonStock(String(m.stock)) !== r.stock) out.push(`stock ${r.stock} ≠ ${m.stock}`);
  if (!m.seller || norm(String(m.seller)) !== norm(r.seller)) out.push(`seller ${r.seller} ≠ ${m.seller}`);
  const a = tokens(r.title), b = tokens(String(m.title ?? ""));
  const overlap = [...b].filter((t) => a.has(t)).length / Math.max(1, Math.min(a.size, b.size));
  if (overlap < 0.6) out.push(`title differs`);
  return out;
}

export async function corroborate(r: FetchResult, raw: string, extractor: Extractor = liquidExtract): Promise<Corroboration> {
  const label = short(r.title);
  try {
    const m = await extractor(snippetOf(raw));
    const mismatches = agree(r, m);
    if (mismatches.length) {
      trace(`HELD ${label} — parser and ${modelName()} disagree: ${mismatches.join("; ")}`);
      return { status: "held", mismatches, detail: mismatches.join("; ") };
    }
    trace(`agreed ${label} · 5/5 fields · ${modelName()} (${LIQUID_WHERE})`);
    return { status: "agreed", mismatches: [], detail: "5/5 fields" };
  } catch (e) {
    // Corroboration is an extra check on ingest; if the model is unavailable the parser's facts are pinned as
    // before and the run says so. The gate is unaffected either way.
    trace(`unavailable for ${label} (${(e as Error).message.slice(0, 50)}) — parser only`);
    return { status: "unavailable", mismatches: [], detail: (e as Error).message };
  }
}
