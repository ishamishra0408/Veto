# 7. Local files are the evidence truth; Tinybird serves it

Date: 2026-09-25

## Status

Accepted

## Context

The counts on stage must be reproducible offline, and the Tinybird lane wants the counts served from a pipe.

## Decision

evidence.ts computes every count from pins.db, receipts.jsonl and runs.jsonl. It syncs all events idempotently, reads the pipe, and prints the pipe's numbers only if they equal the local ones; otherwise local wins and the line says so. With no token it prints local and exits 0.

## Consequences

Rejected: Tinybird as the store of record (a network dependency inside the demo), and no Tinybird (loses the lane). R16 runs the counts with and without network and requires identical numbers.

## In the code

veto/evidence.ts; veto/tinybird.ts remoteCounts(); veto/stream.ts emit(); veto/tinybird/endpoints/vault_evidence.pipe; redproofs_p3.sh R16.
