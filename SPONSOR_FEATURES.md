# Sponsor hero features — build status (2026-09-24 late; corrected night per live runs)

## Nimble — built on
| Hero feature | How the build uses it | Where | Built? |
|---|---|---|---|
| MCP server (`mcp.nimbleway.com/mcp`, Streamable HTTP, `nimble_`-prefixed tools) | Collection layer; live fetches visible in the first 60s | Phase 3 adapter, Phase 4 live key | Y |
| Plugin (`/plugin install nimble`) | OPEN (C3): agent runs on OpenRouter, not Claude Code — plugin is not in the runtime path | — | N (pending) |
| Extract (`nimble_extract`) | The 5 live Amazon product pages in the villain scenario, fetched concurrently (~10s) | adapters.ts / scenario.ts | Y |
| Extract Template | Tried: `best_buy_pdp` timed out (463s), `amazon_pdp` returned no parsed results — not used (C1) | — | N |
| Agent Skills format | The cite-pins rule ships as a one-file skill in their publish format | veto/skill/SKILL.md, R15 | Y |
| Trust-stack vocabulary (source control → grounding → confidence, Sep 23 post) | Positioning only — Veto is the stage after their stack, not a used API | Spec seam section | Positioning |
| Zero-maintenance pipelines | Narrative villain only (the accomplice that never notices drift) — deliberately NOT configured | Spec | N |

## Tinybird — built on
| Hero feature | How the build uses it | Where | Built? |
|---|---|---|---|
| Datasources + Pipes (SQL → production API) | Evidence read path: pins, receipts, runs ingested as events; counts API serves the metric readouts. Never inside the gate, never in the pitch. Local files stay source of truth with offline fallback | veto/tinybird/ (Forward deployment #1), tinybird.ts, R16 | Y |

## Liquid AI — built on
| Hero feature | How the build uses it | Where | Built? |
|---|---|---|---|
| LFM2.5 small model (`liquid/lfm-2.5-2.6b:free` on OpenRouter — 1.2B not listed, C2) | Report-writing agent: reasons over pinned facts, writes the pin-cited report. Generator/verifier — agent proposes, gate disposes; deterministic template fallback | agent.ts (reasoning effort low), R17 | Y |

Pitch discipline: single-lane Nimble only. Tinybird and Liquid are never mentioned on stage.
