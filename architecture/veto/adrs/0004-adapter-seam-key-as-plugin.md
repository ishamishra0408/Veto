# 4. One fetch seam; the live adapter is a plug-in behind it

Date: 2026-09-25

## Status

Accepted

## Context

The only external blocker was a Nimble API key. The build could not wait on it, and a demo that dies without a key is not a demo.

## Decision

FetchAdapter is the seam. MockAdapter reads deterministic fixtures; NimbleMCPAdapter speaks JSON-RPC to the MCP server. Nothing outside adapters.ts names either (R1); the two return the same FetchResult shape (R10).

## Consequences

Rejected: calling Nimble's REST API directly (the demo is about the agent-native MCP surface) and mocking at the HTTP layer (would not prove the seam). World injectors wrap either adapter, so the same drift runs on mock and live data.

## In the code

veto/adapters.ts FetchAdapter, MockAdapter, NimbleMCPAdapter, getAdapter(); veto/conformance.ts; redproofs_p1.sh R1, redproofs_p3.sh R10.
