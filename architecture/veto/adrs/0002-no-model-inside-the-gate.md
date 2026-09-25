# 2. No model inside the revalidation gate

Date: 2026-09-25

## Status

Accepted

## Context

The safety check must not depend on the component that might be wrong. A model can be asked to re-verify, and it can be wrong in the same way twice.

## Decision

gate.ts is a pure function: re-fetch every cited source through the same adapter seam, re-hash each fact, compare to the pin. It imports no model client, and R7 greps it to prove that on every run.

## Consequences

Rejected: an LLM judge that reads old and new pages and decides whether the change matters (undecidable and unauditable), and a tolerance band on prices (a policy the gate should not own). The gate cannot tell a trivial change from a material one; that is the re-base path's job, with disclosure.

## In the code

veto/gate.ts revalidate(); veto/redproofs_p2.sh R7.
