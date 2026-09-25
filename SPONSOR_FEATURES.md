# Veto — the ship lock for long-horizon agents. Sponsor hero features — build status (2026-09-24 late; corrected night per live runs)

## Nimble — built on
| Hero feature | How the build uses it | Where | Built? |
|---|---|---|---|
| MCP server (`mcp.nimbleway.com/mcp`, Streamable HTTP, `nimble_`-prefixed tools) | Collection layer; live fetches visible in the first 60s | Phase 3 adapter, Phase 4 live key | Y |
| Plugin (`/plugin install nimble`) | Not used (C3 decided): Veto calls Nimble's MCP server directly from its own code; the plugin is a Claude Code surface outside Veto's runtime. The first 60s show Veto's own MCP session instead | — | N (by design) |
| Search (`nimble_search`) | Planner re-plan: a lost competitor page (unreachable or no extractable price) is replaced by a comparable listing found by search, then corroborated and pinned — used live in the final run | veto/adapters.ts, veto/report.ts, R25 | Y |
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
| LFM2.5-1.2B-Instruct (on-device, Ollama; OpenRouter `lfm-2.5-2.6b:free` fallback) | Report-writing agent: JSON claims over pinned facts; deterministic claim checker + citation repair (agent proposes, gate disposes); template fallback | veto/agent.ts, veto/liquid.ts, R17 R22 | Y |
| LFM2-1.2B-Extract (on-device, Ollama) | L1: second, independent extractor — a page is pinned only if it agrees with the parser; never called from the gate | veto/extract.ts, R18 | Y |

Pitch discipline: single-lane Nimble only. Tinybird and Liquid are never mentioned on stage.
