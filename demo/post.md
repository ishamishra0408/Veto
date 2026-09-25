# Submission text — Veto, the ship lock for long-horizon agents
Repo: https://github.com/ishamishra0408/Veto
For the tokens& form at tokensand.com/horizonagentshack/submit ("what you built and the tools you used"). Optional X post afterwards tagging @tokensandai.

## What you built

**Hook.** "Most production AI fails aren't because the models are not good enough — it's because of a data failure." Nimble's CEO said that to TechCrunch in February. We built the stage that makes it true at the moment of action, not just the moment of retrieval.

**The problem.** A pricing agent fetches competitor prices at 6 pm, reasons overnight, and ships a repricing report at 6 am. At 9 pm one competitor dropped 15 %. The 6 am report recommends matching a price that no longer exists. The model did everything right. The data moved. Every trust check in the stack ran before 9 pm.

**The seam.** Nimble's web data is live and governed: source control chooses the evidence, grounding checks the evidence supports each value, confidence says how strongly, all while the agent is working. That stack ends when the run ends. Veto is the stage after it: it pins every fact with a content hash and a fetch timestamp, makes the agent cite pins instead of pages, and re-validates the pinned basis deterministically before anything ships. Nimble tells you the web changed. Veto tells you your report's basis changed, and refuses.

**The mechanism.** Collect through the Nimble MCP server: `nimble_extract` on each product page, and `nimble_search` to re-plan around a page that is lost. Pin `{fact, sha256, fetched_at}` per fact, but only after two independent extractors, the deterministic parser and Liquid's on-device extraction model, agree on the page; a disagreeing page is held. Reason against pins. Before ship, a pure function re-fetches, re-hashes, compares: CLEAN ships, DRIFTED refuses with a JSON receipt and a plain-English why, UNREACHABLE refuses (fail closed, never a stale ship). Then the agent self-corrects: the plan is a dependency graph from conclusions to pins, so a drift names exactly the conclusions it broke; Veto re-pins them, recomputes the recommendation, discloses the change as `[was-pin:]`, re-gates, and ships the truth. Two counts prove it: `N facts pinned · M drifted-and-flagged · 0 shipped contradictions` and `K clean runs shipped · 0 false refusals`.

**Demo beats.** {{DEMO_VIDEO_LINK}} — Nimble fetch in the first minute, the cited report, the drift, the REFUSED banner and receipt, the counts.

## Tools used
Nimble MCP server (`https://mcp.nimbleway.com/mcp`, Streamable HTTP): `nimble_extract` collects each product page, `nimble_search` re-plans a lost page onto a comparable listing; one Agent Skill in Nimble's Agent Skills format (`veto/skill/SKILL.md`, the cite-pins rule). Tinybird: one datasource ingesting the vault's pins, receipts and runs, one pipe serving the evidence counts as an API. Liquid AI on-device via Ollama: LFM2.5-1.2B-Instruct writes the pin-cited report as JSON claims over the pinned facts, and LFM2-1.2B-Extract is the second extractor that must agree with the parser before a fact is pinned (OpenRouter `liquid/lfm-2.5-2.6b:free` is the fallback; veto/liquid.ts). Tinybird also streams every event as it happens and serves the gate's p95 latency and fact volatility across live runs. Python 3, SQLite, Claude Code.

## Honest notes
- The five product pages are fixtures; the run labels them. The recorded run fetched live through Nimble MCP (session 4d0a0d93, 48 trace rows in evidence/live-run-2026-09-25-demo/mcp-trace.jsonl).
- The 15 % drop is simulated by flipping one fixture price. No real customer's agent broke; the villain is the segment's daily world.
- The gate is this project's logic, application-level. Nothing in Nimble was changed and nothing here is Nimble behaviour.
- The report writer is a Liquid LFM2.5 agent; the agent proposes, the deterministic gate disposes, and the agent is never inside the gate. On earlier live runs the model invented pin ids and borrowed prices; the checker dropped those claims before any draft (README, Result). The recorded run's report was written by the agent, on device (runs.jsonl: agent hf.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF:Q4_K_M, both nights).
- Evidence counts are served by a Tinybird pipe and are identical to the counts computed from the local files with no network (red proof R16). The local files are the source of truth.
- No efficiency claims. Wall time of the full two-night live arc as measured on 2026-09-25: 260 s; the recorded night-2 run is about 2 min. 30 scripted red proofs pass. The recorded run's counts: 29 facts pinned · 1 drifted-and-flagged · 0 shipped contradictions (evidence/live-run-2026-09-25-demo).

## Pre-publish checklist
- [ ] Demo video link live and shareable
- [x] Repo public: https://github.com/ishamishra0408/Veto
- [ ] Every screenshot a real run, or labelled mockup
- [ ] Every citation URL opened live today
- [ ] Team names and contact emails in the form
- [x] Working website: https://ishamishra0408.github.io/Veto/architecture/veto/site/
