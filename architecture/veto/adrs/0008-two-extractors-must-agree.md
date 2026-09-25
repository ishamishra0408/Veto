# 8. Two independent extractors must agree before a fact is pinned

Date: 2026-09-25

## Status

Accepted

## Context

A pin is only as good as the parse that produced it. One parser reading one page can pin a wrong value with a valid hash.

## Decision

At ingest, the deterministic parser and Liquid's extraction model each read the same page. If any of the five fields disagree, the page is held: nothing from it is pinned or cited, and the run says so. If the model is unavailable the parser's facts are pinned and the run says that too. The gate never calls the corroborator.

## Consequences

Rejected: majority voting with a third extractor (cost, and no third independent reader existed), and corroborating at revalidation (would put a model near the gate, against ADR 2). A held page reduces the basis; a smaller basis is preferred to a doubtful one.

## In the code

veto/extract.ts corroborate(), agree(); veto/report.ts; redproofs_p3.sh R18.
