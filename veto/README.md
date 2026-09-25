# Veto — Phase 1

The agent pins every fact (sha256 + timestamp), cites pins not pages, and revalidates before ship.

Runtime: **Node ≥ 22.18, TypeScript**, run directly (native type stripping). Storage: built-in `node:sqlite`. No runtime dependencies; `typescript` is dev-only for `npm run typecheck`.

| File | Role |
|---|---|
| `adapters.ts` | `FetchAdapter` seam; `getAdapter()` picks impl via `VETO_ADAPTER` (`mock` default, `nimble` = Phase 3 stub) |
| `pages.txt` | 5 fixtures: url, title, price, stock, rating, seller |
| `pins.ts` | SQLite `pins.db`; `pin_id = sha256(canonical fact)[:12]`; `INSERT OR IGNORE` keeps first `fetched_at` |
| `report.ts` | fetch → pin 5 facts/page → `report.md` citing `[pin:…]` only |
| `verify_pins.ts` | every cited pin must exist AND re-hash to itself; exit 1 on MISSING |
| `redproofs_p1.sh` | R1 seam, R2 tamper, R3 no-URL proofs |

```bash
cd veto && npm install && npm run typecheck && npm run redproofs
```

## Phase 2 — revalidate gate

| File | Role |
|---|---|
| `gate.ts` | `revalidate(dbPath, adapter, basisPinIds)`: re-fetch → re-hash → compare, read-only. `CLEAN` ships; `DRIFTED` / `UNREACHABLE` refuse (fail closed) |
| `receipts.ts` | appends one line per refusal to `receipts.jsonl` |
| `simulate.ts` | `--clean` / `--drift` / `--outage`; report.md is written only on CLEAN |
| `redproofs_p2.sh` | R4–R8 |

```bash
bash veto/redproofs_p1.sh && bash veto/redproofs_p2.sh
```

**G1:** `report.ts` alone writes `report.draft.md` only. `ship.ts` is the single path that writes `report.md`, and it only does so after the gate.
**G2:** `simulate.ts --drift --rebase` refuses the old basis and writes a receipt, then re-pins on fresh facts and ships. The superseded facts are disclosed as `[was-pin:…]`.

## Phase 3 — Nimble adapter, villain, demo

| File | Role |
|---|---|
| `adapters.ts` | `NimbleMCPAdapter`: raw JSON-RPC over streamable HTTP (`initialize` → `tools/list` → `tools/call nimble_extract`), logs every call to stderr. It fails closed if the key or any field is missing. |
| `worlds.ts` | `PriceShift` / `Outage` injectors that wrap any adapter, mock or Nimble |
| `ship.ts` | draft → gate → ship or refuse; appends `runs.jsonl` |
| `scenario.ts` | 6pm pins → 9pm competitor −15% → 6am gate (`--clean` = no drop) |
| `evidence.ts` | north-star + counter lines, computed from pins.db / receipts.jsonl / runs.jsonl |
| `conformance.ts` | R10 shape check (live if `NIMBLE_API_KEY` is set) |
| `demo.sh [--real]` | resets state; clean night ships, villain night refuses; prints counts |

`--real` needs `NIMBLE_API_KEY` and 5 live URLs in `pages.real.txt`. Optional settings: `NIMBLE_EXTRACT_TOOL`, `NIMBLE_EXTRACT_ARGS` (JSON), `NIMBLE_MCP_URL`.
