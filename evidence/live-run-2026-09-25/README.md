# Live run — 2026-09-25 05:43–05:44 UTC

One `bash veto/demo.sh --real` run: Nimble MCP (`nimble_extract`) → 5 Amazon product pages → pins → Liquid agent → gate.

| File | What it is | What it is not |
|---|---|---|
| `1_pins.json` | All 28 pins in `pins.db` after the run. Night-1 basis = the 25 whose sha256 is in receipt 1's `pin_hashes`; the other 3 are facts that changed and were re-pinned at night 2's 18:00 fetch. | Not a curated sample |
| `2_receipt_live_unforced.json` | Night 1 refusal. **Nothing injected** — Amazon changed Sennheiser price 284.90 → 287.00 USD and stock Low → In stock between fetches ~30s apart. | Not a simulated drift |
| `2b_receipt_injected_last_line.json` | Night 2 refusal: the injected −15% Bose drop (327.99 → 278.79) plus one real seller change on Sony. | — |
| `3_evidence.txt` | `evidence.ts` output; Tinybird pipe matched local counts. | — |
| `4_urls_titles.txt` | The 5 source URLs and titles as pinned. | — |
