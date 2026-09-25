# 9. The refusal's plain-English reason is built from the receipt, deterministically

Date: 2026-09-25

## Status

Accepted

## Context

A refusal must be legible to a person, and a sentence a model wrote about why it refused could itself be wrong.

## Decision

The explanation is composed from the receipt's own fields (product, field, old value, new value, pin ids) by a template, then passed through the same claim checker the writer faces. It is stored in the receipt as `explanation`.

## Consequences

Rejected: asking the writer model to explain the refusal (a second thing that could be wrong), and no explanation (a receipt only an engineer can read). The sentence is always true because it is a rendering of the data.

## In the code

veto/ship.ts explanation; veto/receipts.ts appendReceipt(explanation); redproofs_p3.sh R19.
