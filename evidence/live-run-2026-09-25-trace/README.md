# Live run with persisted MCP trace — 2026-09-25 19:21 UTC

One `bash veto/demo.sh --real`: Nimble MCP (`nimble_extract`) → 5 Amazon pages → L1 on-device Liquid corroboration → pins → Liquid writer → gate. Night 1 nothing injected; night 2 injects a −15% price on a cited product.

| File | What it is | What it is not |
|---|---|---|
| `mcp-trace.jsonl` | Every MCP request as sent: `{ts, method, tool?, url?, ms, http}`. Two sessions (one per night): `initialize`, `notifications/initialized`, `tools/list`, then 5 parallel `tools/call nimble_extract` per fetch (18:00 pin + 06:00 gate) = 20 calls. `ts` = request start; `ms` = to full response body. Rows are appended in completion order. | Not the response bodies |
| `runs.jsonl` | One row per night: verdict, mode, `agent` (report writer model), `claims_kept/dropped`, `gate_ms`, per-fact `checks`. | — |
| `receipts.jsonl` | Both refusals, each with a deterministic plain-English `explanation`. | — |
| `pins.json` | All pins in `pins.db` after the run. | Not only one night's basis |
| `report.draft.md` | Night 2's draft — the report that was refused. | Not a shipped report |
| `evidence.txt` / `demo-output.txt` | Counts (Tinybird pipe matched local) and the full terminal output (session id redacted). | — |
