---
name: cite-pins
description: Pin every web fact with sha256 + fetch time, cite pins (not pages) in any report, and revalidate every cited pin against the live page before the report ships. Use when an agent produces a report from Nimble web data that will be acted on later than it was fetched.
---

# Cite pins, not pages

**Trust is a property of the moment of action, not the moment of retrieval.**

Nimble's trust stack covers the run: source control at fetch time, grounding and confidence while the agent writes. This skill covers the stage after the run ends — the gap between when facts were fetched and when the report is acted on. Revalidation happens at ship time.

## When to pin
Every fact the report will state, at ingest, the moment it is fetched (this vault fetches with the Nimble MCP tool `nimble_extract`). One pin per fact. Five facts per product page: `title`, `price`, `stock`, `rating`, `seller`.

## Pin schema
Stored in SQLite `pins.db`, one row per fact:

| field | meaning |
|---|---|
| `pin_id` | first 12 hex chars of `sha256` — the pin is content-addressed |
| `fact_text` | canonical fact: `<field> of <source url> is <value>`, whitespace collapsed |
| `sha256` | sha256 of `fact_text` |
| `fetched_at` | ISO-8601 UTC time of the fetch |
| `source_url` | page the fact came from — stays in the vault, never in the report |

The same fact always hashes to the same pin; a pin keeps the timestamp of its first fetch.

## The citation rule
- Every factual claim in the report ends with the pin(s) it rests on, e.g. `$399.99 [pin:85dd78b6c3fb]`, `Sony WH-1000XM5 Wireless Noise Canceling Headphones [pin:1b78a1d31a3b]`.
- No URLs in the report. No claim without a pin.
- A pin resolves only if its row exists **and** its `fact_text` still hashes to its `sha256` (`verify_pins.ts`). A tampered or invented pin prints `MISSING`.
- Agent-written sentences are machine-checked before they enter a draft: dropped if uncited, if they cite a pin not in the basis, if they contain a URL, or if a number in them is not in the facts they cite.
- After a re-base, superseded facts stay visible as `[was-pin:<id>]` next to the new `[pin:<id>]`.

## Revalidate before ship
`gate.ts` — deterministic, no model inside:
1. Re-fetch every source cited by the draft.
2. Re-hash each cited fact from the fresh page.
3. Compare with the pinned hash.

| verdict | action |
|---|---|
| `CLEAN` | ship `report.md` |
| `DRIFTED` | refuse; re-base on fresh pins and disclose the change, or do not ship |
| `UNREACHABLE` | refuse — fail closed; never ship on stale pins |

Every refusal appends one JSON line to `receipts.jsonl`: `{refused_at, reason, drifted_facts, error, pin_hashes, basis_window}`.
Only `ship.ts` writes `report.md`, and only after `CLEAN`.
