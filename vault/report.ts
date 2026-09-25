// Fetch -> pin -> compose. Standalone run writes a DRAFT only: report.md ships through the gate (ship.ts).
import { writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { getAdapter, pageUrls, type FetchAdapter } from "./adapters.ts";
import { agentAnalysis } from "./agent.ts";
import type { Drift } from "./gate.ts";
import { connect, factValue, PIN_LEN, pinResult, type Field, type Pin } from "./pins.ts";

export const REPORT = new URL("./report.md", import.meta.url);
export const DRAFT = new URL("./report.draft.md", import.meta.url);
const cite = (p: Pin) => `[pin:${p.pin_id}]`;

export async function buildReport(adapter: FetchAdapter, db: DatabaseSync, disclosures: Drift[] = []): Promise<string> {
  const products: Record<Field, Pin>[] = [];
  // Fetch all pages concurrently, pin in page order (deterministic pin order).
  const results = await Promise.all(pageUrls().map((url) => adapter.fetch(url)));
  for (const r of results) products.push(pinResult(db, r));

  // Reason over the PINNED fact text, not the fetch result.
  const v = (p: Record<Field, Pin>, f: Field) => factValue(p[f]);
  const price = (p: Record<Field, Pin>) => parseFloat(v(p, "price"));
  const rating = (p: Record<Field, Pin>) => parseFloat(v(p, "rating"));
  const byPrice = [...products].sort((a, b) => price(a) - price(b));
  const lo = byPrice[0], hi = byPrice[byPrice.length - 1];
  const top = [...products].sort((a, b) => rating(b) - rating(a))[0];
  const buyable = products.filter((p) => !/out of stock|sold out/i.test(v(p, "stock")));
  const cheapBuyable = [...buyable].sort((a, b) => price(a) - price(b))[0];
  const thirdParty = products.filter((p) => v(p, "seller") !== "Best Buy");
  const name = (p: Record<Field, Pin>) => `${v(p, "title")} ${cite(p.title)}`;

  const lines = [
    "# Headphones Price Report", "",
    "Every factual claim cites a content-addressed pin. Sources live in the vault, not in this report.", "",
    "## Products", "",
    "| # | Product | Price | Stock | Rating | Seller |",
    "|---|---|---|---|---|---|",
    ...products.map((p, i) =>
      `| ${i + 1} | ${name(p)} | $${v(p, "price").replace(" USD", "")} ${cite(p.price)} | ${v(p, "stock")} ${cite(p.stock)} | ${v(p, "rating")} ${cite(p.rating)} | ${v(p, "seller")} ${cite(p.seller)} |`),
    "", "## Findings", "",
    `- Cheapest listed: ${name(lo)} at $${price(lo).toFixed(2)} ${cite(lo.price)}.`,
    `- Most expensive: ${name(hi)} at $${price(hi).toFixed(2)} ${cite(hi.price)}.`,
    `- Spread: $${(price(hi) - price(lo)).toFixed(2)} ${cite(hi.price)} ${cite(lo.price)}.`,
    `- Highest rated: ${name(top)} at ${v(top, "rating")} ${cite(top.rating)}.`,
    ...(cheapBuyable ? [`- Cheapest you can buy now: ${name(cheapBuyable)} at $${price(cheapBuyable).toFixed(2)} ${cite(cheapBuyable.price)}, ${v(cheapBuyable, "stock")} ${cite(cheapBuyable.stock)}.`] : []),
    ...thirdParty.map((p) => `- Third-party seller: ${name(p)} is sold by ${v(p, "seller")} ${cite(p.seller)}.`),
    "",
  ];
  // Agent section: the model sees only pinned facts (URL replaced by product title); only verified claims enter.
  const basis = products.flatMap((p) => (["title", "price", "stock", "rating", "seller"] as Field[]).map((f) =>
    ({ pin_id: p[f].pin_id, fact: `${f} of ${v(p, "title")} is ${v(p, f)}` })));
  const agent = await agentAnalysis(basis);
  if (agent?.kept.length) lines.push("## Agent analysis", "", ...agent.kept.map((k) => `- ${k}`), "");
  if (disclosures.length) {
    lines.push("## Re-based (drift disclosed)", "",
      "The original basis drifted before ship. This report is re-pinned on fresh facts; superseded facts are disclosed, not silently replaced.", "",
      ...disclosures.map((d) => {
        const p = products.find((x) => x.title.source_url === d.source_url);
        return `- ${p ? name(p) : "A tracked product"}: ${d.field} moved from ${d.old_value} [was-pin:${d.pin_id}] to ${d.new_value} [pin:${d.new_hash.slice(0, PIN_LEN)}].`;
      }), "");
  }
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = await buildReport(getAdapter(), connect());
  writeFileSync(DRAFT, text);
  console.log(`wrote report.draft.md (${text.match(/\[pin:/g)?.length ?? 0} citations) — not shipped; run ship.ts to gate it`);
}
