// Report-writing agent: Liquid LFM2.5 via OpenRouter. Generator/verifier — the agent proposes, the checks dispose.
// The agent sees ONLY pinned facts. Every sentence it writes is machine-checked before it can enter a draft;
// the gate still revalidates every cited pin before ship. The trust guarantee never depends on the model.
import { LIQUID_MODEL as AGENT_MODEL, LIQUID_WHERE, liquidChat } from "./liquid.ts";
export { AGENT_MODEL };
const trace = (msg: string) => process.stderr.write(`\x1b[35m[liquid agent]\x1b[0m ${msg}\n`);

export interface BasisFact { pin_id: string; fact: string; product?: string } // fact = "<field> of <product> is <value>"

export const shortName = (title: string) => title.split(/[,(]| - /)[0].trim().split(/\s+/).slice(0, 4).join(" ");

export interface ClaimCheck { kept: string[]; dropped: { sentence: string; reason: string }[] }

// Numbers as whole tokens: "29" never matches inside "298.00", and digits inside model names ("WH-1000XM5",
// "Momentum 4") are removed with the product names first. "out of 5" is rating boilerplate, not a claim.
const stripNames = (s: string, basis: BasisFact[]) =>
  [...new Set(basis.map((b) => b.product).filter((p): p is string => !!p))].sort((a, b) => b.length - a.length)
    .reduce((acc, p) => acc.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " "), s);
export const numbersIn = (s: string, basis: BasisFact[] = []) =>
  (stripNames(s.replace(/\[(?:was-)?pin:[0-9a-f]+\]/g, " "), basis).replace(/\bout of 5\b/gi, " ")
    .match(/(?<![A-Za-z0-9.\-])\d+(?:[.,]\d+)*(?![A-Za-z0-9])/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
const valueNumbers = (fact: string) => numbersIn(fact.split(/ is (?:now )?| was /).slice(1).join(" ").replace(/ when the report was drafted$/, ""));
const fieldOf = (fact: string) => fact.split(" of ")[0];

// A sentence that talks about a field must cite a pin of that field (no "out of stock" citing a price pin).
const FIELD_WORDS: Record<string, RegExp> = {
  price: /\b(prices?|priced|pricing|pricier|costs?|cheap(?:er|est)?|expensive|usd)\b|\$/i,
  stock: /\b(stock|in-stock|availab\w*|sold out)\b/i,
  rating: /\b(rating|rated|stars?)\b/i,
  seller: /\b(sold by|seller|merchant)\b/i,
};
const SPECULATIVE = /\b(will|next (?:week|month|quarter)|expected to|likely|probably|forecast)\b/i;
const CHEAPER = /\b(cheaper|less expensive|lower[- ]priced|undercuts?|costs? less)\b[^.]*?\bthan\b|\bundercuts?\b/i;
const PRICIER = /\b(more expensive|pricier|higher[- ]priced|costs? more)\b[^.]*?\bthan\b/i;

// Deterministic claim checker. A sentence survives only if: it cites >= 1 pin, every cited pin is in the basis,
// it contains no URL, every number is a whole-token value of a fact it cites, every field it talks about is
// cited, it names no product it doesn't cite, it isn't speculative, and any price comparison matches the
// cited prices. It checks citations and numbers — not the meaning of adjectives ("great value").
export function checkClaims(text: string, basis: BasisFact[]): ClaimCheck {
  const byId = new Map(basis.map((b) => [b.pin_id, b]));
  const out: ClaimCheck = { kept: [], dropped: [] };
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?](?:\s*\[pin:[0-9a-f]+\])*)\s+(?=[A-Z*-])/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const ids = [...s.matchAll(/\[pin:([0-9a-f]+)\]/g)].map((m) => m[1]);
    const facts = ids.map((id) => byId.get(id));
    const cited = facts.filter((f): f is BasisFact => !!f);
    let reason = "";
    if (/https?:|www\./i.test(s)) reason = "contains a URL";
    else if (!ids.length) reason = "uncited claim";
    else if (facts.some((f) => !f)) reason = `cites a pin not in the basis`;
    else if (SPECULATIVE.test(s)) reason = "speculative (not a pinned fact)";
    else {
      const values = new Set(cited.flatMap((f) => valueNumbers(f.fact)));
      const bad = numbersIn(s, basis).filter((n) => !values.has(n));
      if (bad.length) reason = `number(s) ${bad.join(", ")} not in the cited facts`;
    }
    if (!reason) {
      const citedFields = new Set(cited.map((f) => fieldOf(f.fact)));
      const prose = stripNames(s.replace(/\[pin:[0-9a-f]+\]/g, ""), basis);
      const missing = Object.entries(FIELD_WORDS).filter(([f, re]) => re.test(prose) && !citedFields.has(f)).map(([f]) => f);
      if (missing.length) reason = `talks about ${missing.join(", ")} without citing it`;
    }
    if (!reason) {
      // A claim that names a product must cite at least one of that product's facts (no one-sided comparisons).
      const citedProducts = new Set(cited.map((f) => f.product).filter(Boolean));
      const named = [...new Set(basis.map((b) => b.product).filter((p): p is string => !!p))]
        .filter((p) => s.toLowerCase().includes(p.toLowerCase().split(" ").slice(0, 2).join(" ")));
      const uncited = named.filter((p) => !citedProducts.has(p));
      if (uncited.length) reason = `names ${uncited.join(", ")} without citing its facts`;
      // Price comparisons are checked against the cited prices, in the order the products are named.
      else if (named.length >= 2 && (CHEAPER.test(s) || PRICIER.test(s))) {
        const lower = s.toLowerCase();
        const [a, b] = named.map((p) => [p, lower.indexOf(p.toLowerCase().split(" ").slice(0, 2).join(" "))] as const)
          .sort((x, y) => x[1] - y[1]).map(([p]) => p);
        const priceOf = (p: string) => valueNumbers(cited.find((f) => f.product === p && fieldOf(f.fact) === "price")?.fact ?? "")[0];
        const pa = priceOf(a), pb = priceOf(b);
        if (pa === undefined || pb === undefined) reason = "price comparison without both prices cited";
        else if (CHEAPER.test(s) ? !(pa < pb) : !(pa > pb)) reason = `comparison contradicts the cited prices (${pa} vs ${pb})`;
      }
    }
    if (reason) out.dropped.push({ sentence: s, reason }); else out.kept.push(s);
  }
  return out;
}

// Returns verified sentences, or null when the agent is off/unavailable (caller keeps the template report).
// Deterministic citation repair: for each number in a claim, if exactly one pinned fact OF A PRODUCT THE CLAIM
// NAMES carries that value, attach its tag. Invented numbers or numbers from another product never match.
export function repairCitations(sentence: string, basis: BasisFact[]): { sentence: string; added: number } {
  const lower = sentence.toLowerCase();
  const named = new Set(basis.map((b) => b.product).filter((p): p is string => !!p && lower.includes(p.toLowerCase().split(" ").slice(0, 2).join(" "))));
  const cited = new Set([...sentence.matchAll(/\[pin:([0-9a-f]+)\]/g)].map((m) => m[1]));
  let added = 0, out = sentence.replace(/\s*\.$/, "");
  for (const n of numbersIn(sentence, basis)) {
    const hits = basis.filter((b) => b.product && named.has(b.product) && valueNumbers(b.fact).includes(n));
    if (hits.length === 1 && !cited.has(hits[0].pin_id)) { out += ` [pin:${hits[0].pin_id}]`; cited.add(hits[0].pin_id); added++; }
  }
  return { sentence: out + ".", added };
}

// Small models cite far better as structured output than inline: ask for JSON claims, render the tags ourselves.
function renderClaims(raw: string): string {
  try {
    const arr = JSON.parse(/\[[\s\S]*\]/.exec(raw)![0]) as { claim?: unknown; pins?: unknown[] }[];
    return arr.map((o) => {
      const claim = String(o.claim ?? "").replace(/\s*\[pin:[^\]]*\]/g, "").trim().replace(/[.]?$/, "");
      const tags = (o.pins ?? []).map((id) => `[pin:${String(id).replace(/^\[?pin:|\]$/g, "")}]`).join("");
      return `${claim} ${tags}.`;
    }).join(" ");
  } catch { return raw; } // not JSON: check the raw text as-is
}

export async function agentAnalysis(basis: BasisFact[]): Promise<ClaimCheck | null> {
  if (process.env.VETO_AGENT === "off" || (!process.env.OPENROUTER_API_KEY && !process.env.VETO_LIQUID_URL)) return null;
  const byProduct = new Map<string, string[]>();
  for (const b of basis) {
    const [field] = b.fact.split(" of ");
    if (field === "title") continue;
    const key = b.product ?? "product";
    byProduct.set(key, [...(byProduct.get(key) ?? []), `${field} ${b.fact.split(" is ").slice(1).join(" is ")} [pin:${b.pin_id}]`]);
  }
  const facts = [...byProduct].map(([p, xs]) => `${p}: ${xs.join("; ")}`).join("\n");
  const t0 = Date.now();
  trace(`${AGENT_MODEL.replace(/^hf\.co\/LiquidAI\//, "").replace(/-GGUF:.*$/, "")} (${LIQUID_WHERE}) · reasoning over ${basis.length} pinned facts`);
  try {
    const raw = await liquidChat(
      "You are a retail pricing analyst. Use ONLY the pinned facts. Each fact is followed by its [pin:...] id. " +
      "Reply with ONLY a JSON array of 3 to 5 objects: " +
      '[{"claim": "<one short comparative sentence, numbers copied exactly>", "pins": ["<id of EVERY fact whose value or product the claim mentions>"]}]. No URLs.',
      `Pinned facts:\n${facts}`);
    const rendered = checkClaims(renderClaims(raw), []).dropped.map((d) => d.sentence); // split into sentences only
    let repaired = 0;
    const text = rendered.map((x) => { const r = repairCitations(x, basis); repaired += r.added; return r.sentence; }).join(" ");
    const check = checkClaims(text, basis);
    trace(`  ← ${Date.now() - t0}ms · ${check.kept.length} claim(s) verified · ${check.dropped.length} dropped · ${repaired} citation(s) repaired deterministically`);
    for (const d of check.dropped.slice(0, 2)) trace(`    dropped (${d.reason}): ${d.sentence.replace(/\s*\[pin:[^\]]*\]/g, "").slice(0, 60)}…`);
    if (check.dropped.length > 2) trace(`    … +${check.dropped.length - 2} more dropped`);
    return check;
  } catch (e) {
    trace(`  unavailable (${(e as Error).message}) — deterministic template only`);
    return null;
  }
}
