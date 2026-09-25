# Live run — 2026-09-25 (final), full two-night arc on real Amazon pages via Nimble MCP

| File | What it is | What it is not |
|---|---|---|
| `demo-output.txt` | Full terminal output of `bash veto/demo.sh --real` (session id redacted). | — |
| `mcp-trace.jsonl` | Every Nimble MCP request `{ts, method, tool, url, ms, http}`, incl. **2 live `nimble_search` calls** (re-planning a lost competitor page). | Not response bodies |
| `plan.json` | Night 2's plan P1–P8 with statuses, impact analysis and recommendation before/after. | Not night 1's (overwritten per night) |
| `runs.jsonl` | Both nights: verdict, `final_verdict`, `rebase_fetched`, writers, `drift_classes`, `false_refusal`, per-fact checks. | — |
| `receipts.jsonl` | Every refusal with `confirm` (moved / flap) and the deterministic `explanation`. | — |
| `ships.jsonl` + `report.shipped.md` + `verify_shipped.txt` | **Night 1's live re-based ship**: refused on unforced drift → flapping facts marked unstable → re-pinned → re-gated CLEAN → shipped. Verifies 25/25. | — |
| `report.draft.md` | Night 2's refused draft. Night 2 re-based twice; Amazon kept moving other pages, so it **refused** (fail closed). | Not a shipped report |
| `pins.json`, `corroboration.json` | All pins; per-pin L1 status (`agreed` / `parser-only`). | — |
| `evidence.txt` | Counts; Tinybird pipe matched local. | — |

What happened, honestly: the watched AirPods page had **no extractable buy-box price** (the adapter refuses to invent one), so the planner searched (`nimble_search`) and pinned a comparable listing. Night 1: refused (no price injected; Amazon's facts moved and some flapped), self-corrected, shipped. Night 2: injected −15% on the anchor competitor; refused; two re-base attempts failed because other pages kept moving → final refusal. After this run the re-base limit was raised to 3 attempts. Live `0 shipped contradictions` = 1 live report shipped, 0 citing a changed fact.
