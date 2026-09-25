# 6. The agent proposes; the gate disposes

Date: 2026-09-25

## Status

Accepted

## Context

A small on-device model writes better analysis than a template but invents pin ids and borrows numbers across products (measured on live runs).

## Decision

The Liquid writer sees only pinned facts and returns JSON claims. A deterministic checker repairs a missing citation only when a number matches exactly one fact of a named product, and drops any claim that is uncited, cites an unknown pin, contains a URL, uses a number its cited facts lack, or names a product it does not cite. If the model is off or unavailable the template report ships unchanged.

## Consequences

Rejected: trusting the model's citations (R17 forges one and the gate must refuse), and no model at all (loses the analysis and the sponsor surface). The model can never lower trust: the gate re-hashes every cited pin regardless of who wrote the sentence.

## In the code

veto/agent.ts checkClaims(), agentAnalysis(); veto/liquid.ts; veto/report.ts agent section; redproofs_p3.sh R17, R22.
