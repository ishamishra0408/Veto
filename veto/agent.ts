// Report-writing agent: Liquid LFM2.5 via OpenRouter. Generator/verifier — the agent proposes, the checks dispose.
// The agent sees ONLY pinned facts. Every sentence it writes is machine-checked before it can enter a draft;
// the gate still revalidates every cited pin before ship. The trust guarantee never depends on the model.
import { LIQUID_MODEL as AGENT_MODEL, LIQUID_WHERE, liquidChat } from "./liquid.ts";
export { AGENT_MODEL };
const trace = (msg: string) => process.stderr.write(`\x1b[35m[liquid agent]\x1b[0m ${msg}\n`);

export interface BasisFact { pin_id: string; fact: string; product?: string } // fact = "<field> of <product> is <value>"

export const shortName = (title: string) => title.split(/[,(]| - /)[0].trim().split(/\s+/).slice(0, 4).join(" ");

export interface ClaimCheck { kept: string[]; dropped: { sentence: string; reason: string }[] }

const numbersIn = (s: string) => (s.replace(/\[pin:[0-9a-f]+\]/g, "").match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));

// Deterministic claim checker. A sentence survives only if: it cites >= 1 pin, every cited pin is in the
// basis, it contains no URL, and every number in it appears verbatim in the facts it cites.
export function checkClaims(text: string, basis: BasisFact[]): ClaimCheck {
  const byId = new Map(basis.map((b) => [b.pin_id, b.fact]));
  const out: ClaimCheck = { kept: [], dropped: [] };
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?](?:\s*\[pin:[0-9a-f]+\])*)\s+(?=[A-Z*-])/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const ids = [...s.matchAll(/\[pin:([0-9a-f]+)\]/g)].map((m) => m[1]);
    const facts = ids.map((id) => byId.get(id));
    const cited = facts.filter(Boolean).join(" ").replace(/,/g, "");
    let reason = "";
    if (/https?:|www\./i.test(s)) reason = "contains a URL";
    else if (!ids.length) reason = "uncited claim";
    else if (facts.some((f) => !f)) reason = `cites a pin not in the basis`;
    else { const bad = numbersIn(s).filter((n) => !cited.includes(n)); if (bad.length) reason = `number(s) ${bad.join(", ")} not in the cited facts`; }
    if (!reason) {
      // A claim that names a product must cite at least one of that product's facts (no one-sided comparisons).
      const citedProducts = new Set(ids.map((id) => basis.find((b) => b.pin_id === id)?.product).filter(Boolean));
      const named = [...new Set(basis.map((b) => b.product).filter((p): p is string => !!p))]
        .filter((p) => s.toLowerCase().includes(p.toLowerCase().split(" ").slice(0, 2).join(" ")));
      const uncited = named.filter((p) => !citedProducts.has(p));
      if (uncited.length) reason = `names ${uncited.join(", ")} without citing its facts`;
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
  const valueOf = (f: string) => f.split(" is ").slice(1).join(" is ").replace(/,/g, "");
  let added = 0, out = sentence.replace(/\s*\.$/, "");
  for (const n of numbersIn(sentence)) {
    const hits = basis.filter((b) => b.product && named.has(b.product) && new RegExp(`(^|[^0-9.])${n.replace(".", "\\.")}([^0-9]|$)`).test(valueOf(b.fact)));
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
  trace(`${AGENT_MODEL.replace(/^hf\.co\/LiquidAI\//, "")} (${LIQUID_WHERE}) · reasoning over ${basis.length} pinned facts`);
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
    for (const d of check.dropped) trace(`    dropped (${d.reason}): ${d.sentence.slice(0, 90)}`);
    return check;
  } catch (e) {
    trace(`  unavailable (${(e as Error).message}) — deterministic template only`);
    return null;
  }
}
