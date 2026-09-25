// Fetch -> pin -> compose. Standalone run writes a DRAFT only: report.md ships through the gate (ship.ts).
import { writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { getAdapter, pageHint, pageUrls, retailerOf, type FetchAdapter, type FetchResult } from "./adapters.ts";
import { AGENT_MODEL, agentAnalysis, shortName } from "./agent.ts";
import { corroborate, type Extractor } from "./extract.ts";
import type { Drift } from "./gate.ts";
import { connect, digest, factsFor, factValue, PIN_LEN, pinResult, type Field, type Pin } from "./pins.ts";

export const REPORT = new URL("./report.md", import.meta.url);
export const DRAFT = new URL("./report.draft.md", import.meta.url);
const cite = (p: Pin) => `[pin:${p.pin_id}]`;

export interface BuildOpts {
  extractor?: Extractor;
  urls?: string[]; // pages to build from (default: the watch list)
  reuse?: Map<string, FetchResult>; // targeted re-base: pages that did not drift, rebuilt from their pins
  replace?: boolean; // re-plan lost pages via adapter.search (default true)
  unstable?: Set<string>; // "url|field" facts seen with different values in this run: shown, never relied on
}

// G5: who wrote the last draft built in this process (the run row records it).
export interface Conclusion { id: string; label: string; text: string; pins: string[] }
export const RULE = { minRating: 4.0, undercut: 0.03 }; // the plan's pricing rule
export const lastBuild = {
  text: "", agent: "template", claims_kept: 0, claims_dropped: 0,
  corroborated: 0, held: 0, parserOnly: 0, pages: 0, reused: 0, unreachable: 0, fetched: 0,
  replacements: [] as { lost: string; replacement: string; title: string }[], urls: [] as string[],
  conclusions: [] as Conclusion[], anchorUrl: "" as string, recommended: null as number | null,
};

export async function buildReport(adapter: FetchAdapter, db: DatabaseSync, disclosures: Drift[] = [], opts: BuildOpts = {}): Promise<string> {
  const products: Record<Field, Pin>[] = [];
  // P2 act: fetch concurrently (pages that did not drift are reused from their pins); pin in page order.
  const urls = opts.urls ?? pageUrls();
  const settled = await Promise.allSettled(urls.map((u) => opts.reuse?.get(u) ? Promise.resolve(opts.reuse.get(u)!) : adapter.fetch(u)));
  const fetchedCount = urls.filter((u) => !opts.reuse?.has(u)).length;
  const results: FetchResult[] = [];
  const unreachable: string[] = [];
  settled.forEach((x, i) => (x.status === "fulfilled" ? results.push(x.value) : unreachable.push(urls[i])));

  // P3 observe — L1: where the adapter kept the raw page, a second extractor (Liquid) must agree before anything
  // is pinned. A page is only re-used without a second read if ALL its facts were already corroborated ("agreed").
  const statusOf = db.prepare("SELECT status FROM corroboration WHERE pin_id = ?");
  const pinIdsOf = (r: FetchResult) => Object.values(factsFor(r)).map((f) => digest(f).slice(0, PIN_LEN));
  const agreedBefore = (r: FetchResult) => pinIdsOf(r).every((id) => (statusOf.get(id) as { status: string } | undefined)?.status === "agreed");
  const check = (r: FetchResult) => {
    const raw = process.env.VETO_CORROBORATE === "off" ? undefined : adapter.raw(r.url);
    if (opts.reuse?.has(r.url) || (raw && agreedBefore(r))) return Promise.resolve({ status: "reused" as const, mismatches: [], detail: "corroborated earlier" });
    return raw ? corroborate(r, raw, opts.extractor) : Promise.resolve(null);
  };
  const checks: (Awaited<ReturnType<typeof check>>)[] = await Promise.all(results.map(check));
  const lost: { url: string; title?: string }[] = [...unreachable.map((url) => ({ url })),
    ...results.filter((_, i) => checks[i]?.status === "held").map((r) => ({ url: r.url, title: r.title }))];

  // Re-plan: replace each lost competitor with a comparable listing found by search (Nimble: nimble_search).
  const replacements: { lost: string; replacement: string; title: string }[] = [];
  if (opts.replace !== false && lost.length) {
    const tracked = new Set([...urls, ...results.map((r) => r.url)]);
    for (const l of lost) {
      const query = l.title ? `${shortName(l.title)} headphones` : (pageHint(l.url) ?? "over-ear noise cancelling headphones");
      const candidates = (await adapter.search(query).catch(() => [] as string[])).filter((u) => !tracked.has(u));
      for (const c of candidates.slice(0, 3)) {
        try {
          const r = await adapter.fetch(c);
          const cc = await check(r);
          if (cc?.status === "held") continue;
          results.push(r); checks.push(cc); tracked.add(c);
          replacements.push({ lost: l.url, replacement: c, title: r.title });
          break;
        } catch { /* try the next candidate */ }
      }
    }
  }

  const held = results.filter((_, i) => checks[i]?.status === "held");
  const setStatus = db.prepare("INSERT OR REPLACE INTO corroboration VALUES (?, ?)");
  const setIfNew = db.prepare("INSERT OR IGNORE INTO corroboration VALUES (?, ?)");
  for (const [i, r] of results.entries()) {
    if (checks[i]?.status === "held") continue;
    products.push(pinResult(db, r));
    for (const id of pinIdsOf(r)) {
      if (checks[i]?.status === "agreed") setStatus.run(id, "agreed");
      else if (checks[i]?.status === "unavailable") setIfNew.run(id, "parser-only");
    }
  }
  const corroborated = checks.filter((c) => c?.status === "agreed").length;
  const reusedN = checks.filter((c) => c?.status === "reused").length;
  const parserOnlyN = checks.filter((c) => c?.status === "unavailable").length;

  // Reason over the PINNED fact text, not the fetch result.
  const v = (p: Record<Field, Pin>, f: Field) => factValue(p[f]);
  const price = (p: Record<Field, Pin>) => parseFloat(v(p, "price"));
  const rating = (p: Record<Field, Pin>) => parseFloat(v(p, "rating"));
  // A fact that changed more than once while being checked is unstable: displayed, never cited or relied on.
  const stable = (p: Record<Field, Pin>, ...fs: Field[]) => fs.every((f) => !opts.unstable?.has(`${p[f].source_url}|${f}`));
  const cell = (p: Record<Field, Pin>, f: Field, shown: string) => (stable(p, f) ? `${shown} ${cite(p[f])}` : `${shown} (unstable, not relied on)`);
  const byPrice = products.filter((p) => stable(p, "price")).sort((a, b) => price(a) - price(b));
  const lo = byPrice[0], hi = byPrice[byPrice.length - 1];
  const top = products.filter((p) => stable(p, "rating")).sort((a, b) => rating(b) - rating(a))[0];
  const buyable = products.filter((p) => stable(p, "stock", "price") && !/out of stock|sold out/i.test(v(p, "stock")));
  const cheapBuyable = [...buyable].sort((a, b) => price(a) - price(b))[0];
  const thirdParty = products.filter((p) => stable(p, "seller") && v(p, "seller") !== retailerOf(p.seller.source_url));
  const name = (p: Record<Field, Pin>) => `${v(p, "title")} ${cite(p.title)}`;

  const lines = [
    "# Headphones Price Report", "",
    "Every factual claim cites a content-addressed pin. Sources live in the veto, not in this report.", "",
    ...(checks.some(Boolean) || unreachable.length ? [`Ingest: ${corroborated} of ${results.length} pages corroborated now by two extractors reading the same page${
      reusedN ? `; ${reusedN} re-used (corroborated earlier)` : ""}; ${held.length} held (extractors disagreed — nothing from them is pinned or cited)${
      parserOnlyN ? `; ${parserOnlyN} parser-only (second extractor unavailable)` : ""}${unreachable.length ? `; ${unreachable.length} unreachable` : ""}${
      replacements.length ? `; ${replacements.length} replaced by a comparable listing found by search` : ""}.`, ""] : []),
    "## Products", "",
    "| # | Product | Price | Stock | Rating | Seller |",
    "|---|---|---|---|---|---|",
    ...products.map((p, i) =>
      `| ${i + 1} | ${name(p)} | ${cell(p, "price", `$${v(p, "price").replace(" USD", "")}`)} | ${cell(p, "stock", v(p, "stock"))} | ${cell(p, "rating", v(p, "rating"))} | ${cell(p, "seller", v(p, "seller"))} |`),
    ...(products.length ? ["", "## Findings", ""] : []),
    ...(products.length ? [] : ["No page passed ingest; nothing to report."]),
  ];
  if (products.length && lo && top) lines.push(
    `- Cheapest listed: ${name(lo)} at $${price(lo).toFixed(2)} ${cite(lo.price)}.`,
    `- Most expensive: ${name(hi)} at $${price(hi).toFixed(2)} ${cite(hi.price)}.`,
    `- Spread: $${(price(hi) - price(lo)).toFixed(2)} ${cite(hi.price)} ${cite(lo.price)}.`,
    `- Highest rated: ${name(top)} at ${v(top, "rating")} ${cite(top.rating)}.`,
    ...(cheapBuyable ? [`- Cheapest you can buy now: ${name(cheapBuyable)} at $${price(cheapBuyable).toFixed(2)} ${cite(cheapBuyable.price)}, ${v(cheapBuyable, "stock")} ${cite(cheapBuyable.stock)}.`] : []),
    ...thirdParty.map((p) => `- Third-party seller: ${name(p)} is sold by ${v(p, "seller")} ${cite(p.seller)}.`),
    "",
  );
  // Agent section: the model sees only pinned facts (URL replaced by product title); only verified claims enter.
  const basis = products.flatMap((p) => (["title", "price", "stock", "rating", "seller"] as Field[]).filter((f) => stable(p, f)).map((f) =>
    ({ pin_id: p[f].pin_id, fact: `${f} of ${shortName(v(p, "title"))} is ${v(p, f)}`, product: shortName(v(p, "title")) })));
  // Plan steps P4/P5 — comparables → anchor → recommendation. Deterministic rule, every input cited.
  const comparables = products.filter((p) => stable(p, "stock", "rating", "price") && !/out of stock|sold out/i.test(v(p, "stock")) && rating(p) >= RULE.minRating);
  const anchor = [...comparables].sort((a, b) => price(a) - price(b))[0];
  const recommended = anchor ? Math.round(price(anchor) * (1 - RULE.undercut) * 100) / 100 : null;
  const recLines: Conclusion[] = [];
  if (anchor) {
    recLines.push(
      { id: "comparables", label: "Comparable set", text: `- Comparable set (in stock, rated at least ${RULE.minRating.toFixed(1)}): ${comparables.map((p) => `${name(p)} ${cite(p.stock)} ${cite(p.rating)}`).join("; ")}.`,
        pins: comparables.flatMap((p) => [p.title.pin_id, p.stock.pin_id, p.rating.pin_id]) },
      { id: "anchor", label: "Anchor price", text: `- Anchor: the cheapest comparable is ${name(anchor)} at $${price(anchor).toFixed(2)} ${cite(anchor.price)}.`,
        pins: [anchor.title.pin_id, anchor.price.pin_id] },
      { id: "recommendation", label: "Recommended price", text: `- **Recommended price: $${recommended!.toFixed(2)}**, undercutting the anchor by ${RULE.undercut * 100}% (rule: anchor × ${(1 - RULE.undercut).toFixed(2)}) ${cite(anchor.price)}.`,
        pins: [anchor.price.pin_id] });
    lines.push("## Recommendation", "", ...recLines.map((c) => c.text), "");
  }
  const findingConclusions: Conclusion[] = lines.filter((l) => l.startsWith("- ") && /\[pin:/.test(l) && !recLines.some((c) => c.text === l))
    .map((l, i) => ({ id: `finding-${i + 1}`, label: l.slice(2, 40).replace(/\s*\[pin:.*$/, ""), text: l, pins: [...l.matchAll(/\[pin:([0-9a-f]+)\]/g)].map((m) => m[1]) }));
  const agent = await agentAnalysis(basis);
  if (agent?.kept.length) lines.push("## Agent analysis", "", ...agent.kept.map((k) => `- ${k}`), "");
  const shaky = products.flatMap((p) => (["price", "stock", "rating", "seller"] as Field[]).filter((f) => !stable(p, f)).map((f) => `${name(p)} ${f}`));
  if (shaky.length) lines.push("## Not relied on", "",
    `- ${shaky.length} fact(s) changed more than once while being checked (an unstable source), so this report displays them but does not rely on them: ${shaky.join("; ")}.`, "");
  if (disclosures.length) {
    lines.push("## Re-based (drift disclosed)", "",
      "The original basis drifted before ship. This report is re-pinned on fresh facts; superseded facts are disclosed, not silently replaced.", "",
      ...disclosures.map((d) => {
        const p = products.find((x) => x.title.source_url === d.source_url);
        return p && !stable(p, d.field)
          ? `- ${name(p)}: ${d.field} moved from ${d.old_value} [was-pin:${d.pin_id}] and kept changing while being checked (unstable, not relied on).`
          : p
          ? `- ${name(p)}: ${d.field} moved from ${d.old_value} [was-pin:${d.pin_id}] to ${v(p, d.field)} ${cite(p[d.field])}.`
          : `- A tracked product (held at re-pin): ${d.field} of the superseded basis was ${d.old_value} [was-pin:${d.pin_id}].`;
      }), "");
  }
  const out = lines.join("\n");
  Object.assign(lastBuild, { text: out, agent: agent ? AGENT_MODEL : "template", claims_kept: agent?.kept.length ?? 0, claims_dropped: agent?.dropped.length ?? 0,
    corroborated, held: held.length, parserOnly: parserOnlyN, pages: results.length, reused: reusedN, unreachable: unreachable.length,
    fetched: fetchedCount, replacements, urls: products.map((p) => p.title.source_url),
    conclusions: [...recLines, ...findingConclusions], anchorUrl: anchor?.price.source_url ?? "", recommended });
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = await buildReport(getAdapter(), connect());
  writeFileSync(DRAFT, text);
  console.log(`wrote report.draft.md (${text.match(/\[pin:/g)?.length ?? 0} citations) — not shipped; run ship.ts to gate it`);
}
