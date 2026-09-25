# Recorded demo run — 2026-09-25, `bash veto/demo.sh --real` (commit after 7cffde2), on-device Liquid

The run the deck cites. Nimble MCP on real Amazon pages; Liquid `LFM2-1.2B-Extract` + `LFM2.5-1.2B-Instruct` via Ollama on the laptop; Tinybird read path.

**Counts (`evidence.txt`):** `29 facts pinned · 1 drifted-and-flagged · 0 shipped contradictions` · counter `1 clean runs shipped · 0 false refusals` · writer (run row `agent`): `hf.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF:Q4_K_M`, both nights.

| Night | What happened | Files |
|---|---|---|
| 1 — a competitor page goes dark at 18:00 (simulated); no price injected | AirPods page lost (and its live page has no extractable price anyway); L1 **held Bose** (parser "In stock" ≠ Liquid "400+"); `nimble_search` replaced **both** with comparable listings; gate **CLEAN** → shipped | `plan.night1.json`, `report.night1.shipped.md` (20/20 verify) |
| 2 — the villain: anchor competitor −15% (injected) | Gate **REFUSED**; confirm fetch: price *moved*; impact: 5 of 9 conclusions broken; re-base attempt 1: the page moved again → flapping facts marked **unstable**, not relied on; attempt 2 re-gated **CLEAN** → shipped re-based, old values disclosed as `[was-pin:]` | `plan.night2.json`, `report.night2.shipped.md` (21/21 verify), `receipts.jsonl` |

| File | What it is | What it is not |
|---|---|---|
| `demo-output.txt` | Full terminal output (session id redacted), 260 s wall time | Not the ~2-min `--night2` stage cut |
| `mcp-trace.jsonl` | Every MCP request: 2× `initialize`/`tools/list`, **3 `nimble_search`**, 39 `nimble_extract` | Not response bodies |
| `runs.jsonl` / `receipts.jsonl` / `ships.jsonl` | Run rows (verdict, `final_verdict`, `rebase_fetched`, writer, claims, `drift_classes`, `false_refusal`) · 1 refusal receipt with `confirm` + `explanation` · 2 ship receipts | `drifted-and-flagged` counts receipted drifts only (the mid-re-base move is logged in the output, not receipted) |
| `pins.json`, `corroboration.json` | All pins; per-pin L1 status | — |
