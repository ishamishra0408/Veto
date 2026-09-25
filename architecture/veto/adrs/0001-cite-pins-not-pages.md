# 1. The report cites pins, never pages

Date: 2026-09-25

## Status

Accepted

## Context

A report that cites a URL cites whatever that page says at the moment someone reads the citation, which is not the moment the analysis used it. The claim and its evidence drift apart silently.

## Decision

Every fact is stored as a pin: canonical fact text, its sha256, the fetch time and the source URL. The report cites `[pin:<id>]` where id is the first twelve hex characters of the hash; a URL never appears in a report (R3).

## Consequences

Rejected: citing URLs with a timestamp (the page can still change, and the reader cannot tell), and citing a page snapshot by full copy (large, and the claim is about a fact, not a page). A citation now resolves or does not; nothing in between.

## In the code

veto/pins.ts: canonical(), digest(), pinResult(), resolve(); veto/report.ts cite(); veto/verify_pins.ts; redproofs_p1.sh R3.
