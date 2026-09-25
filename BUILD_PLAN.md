# Vault build plan — TONIGHT (2026-09-24)

> **Correction (additive, 2026-09-24, per Isha):** runtime is **TypeScript on Node ≥ 22.18** (decision D1), not Python.
> Every `.py` below is `.ts`; "venv, requirements" is `package.json` + `tsconfig.json`; scripts run as
> `node --disable-warning=ExperimentalWarning vault/<file>.ts`. `NotImplementedError` = a thrown `Error("NotImplemented…")`.

Goal: whole thing built tonight; tomorrow is pitch + networking.
Nothing is blocked except live-key verification before the demo — the key is self-served
(signup → 5,000 free pages, no card → Account Settings → API Keys).

**How checkpoints work:** each phase ends at a checkpoint. A checkpoint is passed only when every red proof listed under it passes. Red proofs are adversarial: they don't check that the code runs, they check that the mechanism *cannot be fooled*. They are pre-registered here, before building. Isha runs them; Devansh advances the go-word only on all-green.

One prompt at a time. Additive corrections only. No scope-out items (SPEC.md). Budget ~15k tokens per phase; report spend with every land.

---

## PHASE 1 — repo + adapter seam + mock + pin store + cite-pins loop

1. `vault/` — TypeScript / Node ≥ 22.18, package.json, tsconfig, README.
2. `vault/adapters.ts`: `FetchResult` `{url, title, price, fetched_at}` (+ stock, rating, seller per D6); `FetchAdapter` base with `fetch(url) -> FetchResult`; `MockAdapter` — 5 deterministic fixture pages recorded in `vault/pages.txt`; `NimbleMCPAdapter` — stub, built in Phase 3.
3. `vault/pins.ts`: one pin per fact to SQLite `vault/pins.db`: `{pin_id, fact_text, sha256, fetched_at, source_url}`; sha256 over canonical fact text.
4. `vault/report.ts`: reasons over PINNED facts; every claim cites `[pin:…]`. No bare URLs, no uncited claims.
5. `vault/verify_pins.ts`: every `[pin:…]` resolves → OK / MISSING; non-zero on MISSING; takes `--db`.
6. `vault/redproofs_p1.sh`: R1–R3.

**CHECKPOINT 1**

| ID | Adversarial test | Command | Must show |
|----|------------------|---------|-----------|
| R1 | The seam is real: nothing outside adapters.ts names MockAdapter | `grep -rn "MockAdapter" vault/ --include=*.ts --exclude-dir=node_modules \| grep -v adapters.ts \| grep -v redproofs` | empty output |
| R2 | Pins are content-addressed | copy pins.db to temp, flip one `fact_text` char in the copy, `verify_pins.ts --db <tmp>`, delete copy | MISSING + non-zero (never OK); real pins.db byte-identical |
| R3 | No uncited facts escape | `grep -c "http" vault/report.md` | `0` |

---

## PHASE 2 — deterministic revalidate gate + fail-closed + receipts

1. `vault/gate.ts` `revalidate(db_path, adapter) -> verdict` — no model inside; re-fetch → re-hash → compare. `CLEAN` ships; `DRIFTED {pin_id, old_hash, new_hash, old_value, new_value}` refuses (re-base or disclose); `UNREACHABLE` fails closed.
2. `vault/receipts.jsonl`: one line per refusal `{refused_at, drifted_facts, pin_hashes, basis_window}`.
3. `vault/simulate.ts`: `--drift` / `--outage` / `--clean`.
4. `vault/redproofs_p2.sh`: R4–R8.

**CHECKPOINT 2**

| ID | Adversarial test | Command | Must show |
|----|------------------|---------|-----------|
| R4 | Drift cannot slip through | `simulate.ts --drift` | REFUSED; receipt with old_hash ≠ new_hash |
| R5 | Outage cannot cause a stale ship | `simulate.ts --outage` | REFUSED; report.md not written |
| R6 | The gate doesn't cry wolf | `simulate.ts --clean` | CLEAN |
| R7 | Safety check independent of the model | `grep -rniE "openai\|anthropic\|llm\|client\." vault/gate.ts` | empty output |
| R8 | Receipts are checkable | receipt pin_hashes vs `SELECT sha256 FROM pins` | all match; refused_at in run window |

---

## PHASE 3 — Nimble adapter code + villain scenario + demo rehearsal

1. `NimbleMCPAdapter` in `vault/adapters.ts` (https://mcp.nimbleway.com/mcp, `Authorization: Bearer ${NIMBLE_API_KEY}`); same `FetchResult` shape; no key → clear error, never an invented key.
2. `vault/scenario.ts`: T0 pins → T1 competitor drops one price 15% → overnight reasoning → 6am gate ⇒ DRIFTED, REFUSED, receipt. `--clean`: no flip ⇒ CLEAN, ships.
3. `vault/evidence.ts`: computed, never hardcoded — `N facts pinned · M drifted-and-flagged · 0 shipped contradictions`; `K clean runs shipped · 0 false refusals`.
4. `vault/demo.sh [--real]`: resets state, full arc, appends `{run_at, adapter, verdict}` to `vault/runs.jsonl`.
5. `vault/redproofs_p3.sh`: R9–R12.

**CHECKPOINT 3**

| ID | Adversarial test | Command | Must show |
|----|------------------|---------|-----------|
| R9 | Not a one-off | `demo.sh && demo.sh` | both REFUSED with receipts; identical verdicts |
| R10 | Real adapter can't change shape | FetchResult keys Nimble == Mock | exact match |
| R11 | Fits a judging slot | `time vault/demo.sh` | < 3 min |
| R12 | Counter is real | `scenario.ts --clean` then `evidence.ts` | CLEAN; K ≥ 1, 0 false refusals; K == CLEAN count in runs.jsonl |

---

## PHASE 3 ADDENDUM (PM update 2026-09-24 late) — Skill, Tinybird, Liquid

> Corrections applied: `.py` → `.ts`; model per C2; Extract Template → `nimble_extract` per C1; plugin beat open per C3.

5. `vault/redproofs_p3.sh`: runs R9–R17 below, prints PASS/FAIL per proof.
6. `vault/skill/SKILL.md`: the cite-pins rule as a one-file Agent Skill in Nimble's publish
   format. Opens with the thesis — "trust is a property of the moment of action, not the
   moment of retrieval" — and positions the Vault as the stage after Nimble's trust stack
   (source control → grounding → confidence → Vault revalidation at ship time). Then:
   when to pin, the pin schema `{fact, sha256, fetched_at}`, the cite-pins-only
   report rule, the revalidate-before-ship gate. It must describe the built vault exactly,
   not an aspirational superset.
7. Tinybird evidence read path (their hero: SQL → production API): create one Tinybird
   datasource ingesting the vault's event stream (pins, receipts, runs) and one pipe
   (SQL) serving the evidence counts as an API. `evidence.ts` prefers the pipe but MUST
   work with no network — local computation from pins.db + receipts.jsonl + runs.jsonl
   is the source of truth and the offline fallback. Tinybird is never inside the gate
   and never in the pitch.
8. Liquid agent report writer (their hero: extraction-tuned small model): `vault/agent.ts`
   calls LFM2.5-1.2B-Instruct via OpenRouter (free tier) with a constrained prompt — the
   pinned facts in-context, instruction to emit ONLY claims of the form `[pin:<id>]` +
   quoted fact text. The agent's report goes through the same `verify_pins.ts` +
   gate as the template report. If the model call fails, fall back to the deterministic
   template — the demo never blocks on the model. Generator/verifier: the agent proposes,
   the gate disposes.

Budget note: this is the biggest phase (adapter + scenario + demo + skill + Tinybird +
agent). If spend approaches 2x the ~15k budget, STOP and report before continuing —
Devansh decides whether to raise it or defer an item.


| ID | Adversarial test | Command | Must show |
|----|------------------|---------|-----------|
| R15 | The Agent Skill describes the built vault, not a fantasy: every pin format it documents resolves | `verify_pins.ts` against the pin format in `vault/skill/SKILL.md` | all documented pin references resolve; the skill mentions no feature the vault doesn't have |
| R16 | The Tinybird read path can't disagree with the local truth: pipe counts vs local counts | `evidence.ts` with network, then with network blocked | identical counts both ways; offline run exits 0 with no exception |
| R17 | The agent can't smuggle a hallucination past the gate: fabricated pin citation | hand-edit one agent-written report to cite `[pin:deadbeef…]` (nonexistent), run `verify_pins.ts` + gate | prints MISSING / REFUSED; no ship |


---

## PHASE 4 — live-key verification

1. Self-serve key: signup → Account Settings → API Keys.
2. `export NIMBLE_API_KEY="<key>" && claude mcp add --transport http nimble https://mcp.nimbleway.com/mcp --header "Authorization: Bearer ${NIMBLE_API_KEY}"`, restart Claude Code.
3. `vault/demo.sh --real`.

**CHECKPOINT 4**

| ID | Adversarial test | Command | Must show |
|----|------------------|---------|-----------|
| R13 | Judge sees Nimble in first 60s | `demo.sh --real` | Nimble MCP tool calls visible fetching live pages |
| R14 | Live pins verify like mock pins | `verify_pins.ts` on the --real run | OK for every citation |

---

## Scoreboard
- [x] Checkpoint 1: R1 R2 R3
- [x] Checkpoint 2: R4 R5 R6 R7 R8 (+ G1 gated-ship-only, G2 re-base)
- [x] Checkpoint 3: R9 R10 R11 R12 (R10 offline; re-run live in P4)
- [x] Checkpoint 3 addendum: R15 R16 R17
- [x] Checkpoint 4: R13 R14 (+ R10 live MATCH). Live source: Amazon via nimble_extract (Best Buy timed out)
