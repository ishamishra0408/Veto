# 5. Drift means the world moved, never that the pipeline broke

Date: 2026-09-25

## Status

Accepted

## Context

Nimble's own writing uses drift for scrapers that break. Veto detects a fixed pinned basis that the world moved under. Two meanings of one word on stage would be a contradiction with the sponsor.

## Decision

A DRIFTED verdict is always a changed fact behind a valid fetch. A failed fetch is UNREACHABLE, a different verdict. The injected villain changes a value, not the fetch.

## Consequences

Rejected: folding outages into drift counts (would inflate the villain), and calling pipeline breakage drift (contradicts the sponsor's usage). Evidence counts drifted facts and refusals separately.

## In the code

veto/gate.ts Verdict union; veto/worlds.ts PriceShift vs Outage; veto/evidence.ts drifted_flagged vs unforced_refusals.
