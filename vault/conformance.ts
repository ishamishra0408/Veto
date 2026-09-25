// R10: the Nimble adapter must return exactly the FetchResult shape the mock adapter returns.
// Live if NIMBLE_API_KEY is set (first URL of pages.real.txt); otherwise the mapper on a sample MCP payload.
import { getAdapter, pageUrls, toFetchResult, type FetchResult } from "./adapters.ts";

const shape = (r: FetchResult) => Object.entries(r).map(([k, v]) => `${k}:${typeof v}`).sort().join(",");
const mock = await getAdapter("mock").fetch(pageUrls("pages.txt")[0]);

let nimble: FetchResult, source: string;
if (process.env.NIMBLE_API_KEY) {
  nimble = await getAdapter("nimble").fetch(pageUrls("pages.real.txt")[0]);
  source = "live Nimble MCP";
} else {
  const sample = { content: [{ type: "text", text: JSON.stringify({ product: {
    title: "Sample Headphones", price: "$129.99", availability: "In stock", rating: 4.3, seller: "Best Buy" } }) }] };
  nimble = toFetchResult("https://example.com/p", sample, new Date().toISOString());
  source = "sample MCP payload (no NIMBLE_API_KEY)";
}
console.log(`mock   : ${shape(mock)}`);
console.log(`nimble : ${shape(nimble)}   [${source}]`);
const ok = shape(mock) === shape(nimble);
console.log(ok ? "MATCH" : "MISMATCH");
process.exit(ok ? 0 : 1);
