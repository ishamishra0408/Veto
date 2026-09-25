# 3. Fail closed when the basis cannot be revalidated

Date: 2026-09-25

## Status

Accepted

## Context

The dangerous path is the quiet one: a fetch that fails at ship time, and a report that ships on yesterday's pins because nothing compared them.

## Decision

Any fetch error, any cited pin absent from the store, or an empty basis returns UNREACHABLE. The ship is refused and a receipt is written; report.md is not touched.

## Consequences

Rejected: ship with a warning (the warning is not read at 6 am), and retry until success (hides an outage inside latency). A transient outage now costs a refusal and a re-run; that is the price of never shipping on stale pins.

## In the code

veto/gate.ts refuse(); veto/ship.ts announce(); veto/worlds.ts Outage; redproofs_p2.sh R5.
