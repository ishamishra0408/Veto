# Veto — Frozen Spec

**Status:** LOCKED 2026-09-24 by Devansh. Changes after this point are additive corrections only, approved by Devansh.
**Addendum 2026-09-24 (evening):** Yaniv's Sep 22 Nimble post and Sep 23 Trust post read live. Seam sharpened on the time axis; drift defined as world drift; Nimble MCP facts pinned (server URL, Streamable HTTP, `nimble_` tool prefixes, plugin steer). Additive only — no scope change except the two flagged items (plugin in first 60s, one-file Agent Skill).
**Addendum 2026-09-24 (late):** Tinybird scoped IN narrowly — evidence read path only (datasource + pipe serving the counts API; never inside the gate, never in the pitch; local files remain source of truth with offline fallback). Liquid AI scoped IN as the report-writing agent (LFM2.5 — 2.6B per C2, free via OpenRouter; generator/verifier — agent proposes, gate disposes; deterministic template fallback; agent never inside the gate). Nimble zero-maintenance pipeline stays UNCONFIGURED — narrative villain only, not a built component. Pitch remains single-lane Nimble.
**Correction 2026-09-24 (night, Isha — additive, from live runs):**
- C1: Collection uses `nimble_extract` (Nimble MCP), not Extract Templates — `best_buy_pdp` timed out (463s) and `amazon_pdp` returned no parsed results. Live source is Amazon (Best Buy failed via Nimble); requests pinned `country=US, locale=en`.
- C2 (updated 2026-09-25): Liquid runs **on-device** via Ollama — writer `LFM2.5-1.2B-Instruct` (Q4_K_M GGUF) and extractor `LFM2-1.2B-Extract` (Q4_K_M), both from huggingface.co/LiquidAI. Fallback when no local server: `liquid/lfm-2.5-2.6b:free` on OpenRouter (the only Liquid model listed there; free tier capped at 50 requests/day). Code: `veto/liquid.ts`.
- C3: `/plugin install nimble` beat is OPEN — the agent runs on OpenRouter, not Claude Code, so a Claude Code plugin install is not in the runtime path. Proposed replacement pending Devansh.
- Runtime is TypeScript / Node ≥ 22.18 (D1); every `.py` in PROMPTS reads `.ts`.
- Live finding: Amazon's buy box rotates seller/price/stock between fetches ~30s apart with nothing injected; the gate refused every time. Used as the live demo beat ("the real page moved on its own").

**Prize lane:** Best use of Nimble ($1,500 + credits). Sole decider: Yaniv Markovski (Head of Ecosystem Engineering @ Nimble; ex-OpenAI, ex-AI21 DevRel).
**Event:** Long Horizon Agents Hackathon, Sep 25 2026. Submission deadline 4:30 PM PT. ~5h build window.

## One-liner
Everyone demos what their agent remembers. We demo what ours refuses: Veto pins every fact with hash + timestamp, cites pins not pages, and deterministically revalidates before ship — it will not ship the contradiction.

**Thesis:** trust is a property of the moment of action, not the moment of retrieval. Nimble verifies the claim while the agent works; Veto verifies the basis when the work ships. With the agent in the loop: the agent works, Nimble grounds it while it works, Veto verifies the basis when it ships.

## The seam (Nimble) — read against everything they've published

Nimble's public trust story, in order. We built the one stage it doesn't cover.
- **Nov 2025, MCP post (Tom Shaked):** the villain, named — "it's rarely because the reasoning model broke. It's because the data fueling the model stopped reflecting reality." Plus "Without fresh and structured data, agents drift."
- **Feb 2026, TechCrunch ($47M):** CEO Knorovich — "most production AI fails aren't because the models are not good enough — it's because of a data failure." Fortune-10 retailers among customers: licenses our villain's segment as the world, not a claimed incident.
- **Sep 22, 2026, ChatGPT/Codex plugin (Yaniv):** distribution — Nimble data behind answers on every surface. "Trust your data with web search governance... use confidence scoring to evaluate the data before acting on it." "Give users confidence that the final answer can be trusted."
- **Sep 23, 2026, Trust post (Tom Shaked):** the trust stack — source control (fetch time), grounding (write time, in-run: "Nimble evaluates trust while the agent is producing the output... before the run is complete"), confidence (write time, granular). Deterministic verification as layer 1: "does the normalized value appear in the cited source?" "A citation shows where information came from. Grounding checks whether the evidence actually supports the output."
- **agent-skills README:** "Stale signals are dropped, not reported."
- **/monitor (beta):** tells you the web changed.

**Where Veto sits:** their stack ends when the run ends. Grounding verifies the claim while the agent works; Veto verifies the basis when the work ships — the 6pm-fetch → 9pm-drop → 6am-ship gap lives entirely after their last check. /monitor watches the world; Veto watches the report's basis — and stops the ship. Nimble drops stale signals; Veto keeps the pinned basis and refuses to ship on it.

**Definitions that keep us honest:**
- **Drift = world drift** (the world moved under a fixed pinned basis). Never "pipeline drift": Nimble's "no data drift" claim refers to scrapers not breaking. Do not contradict it; use their own "agents drift" sentence instead.
- Their FAQ concedes grounding "cannot guarantee that every source is itself correct" — and it cannot guarantee a source is still correct *later*. That later is the stage we built.
- Domain authority: **Git** — content-addressed pins (hash = identity), drift detected by re-hash. "What git did for code, Veto does for evidence."

## Villain (retail pricing world — Nimble's biggest-customer segment)
A Fortune-10 retailer's pricing agent works overnight against competitor prices fetched at 6pm. At 9pm the competitor drops 15%. The 6am report recommends matching a price that no longer exists — millions of SKUs repriced against a ghost. The model did everything right. The data moved.
- Opening flash, in Nimble's own words (attributed on screen): "they often produce outdated or inaccurate results, and it's rarely because the reasoning model broke. It's because the data fueling the model stopped reflecting reality." — Tom Shaked, Nimble blog, Nov 20 2025. CEO version (TechCrunch, Feb 2026): "most production AI fails aren't because the models are not good enough — it's because of a data failure." The line is theirs; the mechanism is ours.
- TechCrunch (Feb 2026) names Fortune-10 retailers among Nimble's customers — this licenses the villain's segment as the world, not a claimed incident.
- Mature-domain mirror (mechanism, not vibe): **Mata v. Avianca (2023)** — the brief cited six cases; none existed. Veto is the mechanism that makes that impossible.

## Mechanism
1. **Collect** — Nimble **MCP server** (agent's tool interface; visible in first 60s of demo): `https://mcp.nimbleway.com/mcp`, Streamable HTTP (current per docs.nimbleway.com; the Nov 2025 blog shows the older /sse endpoint — use the docs), tools prefixed `nimble_` (Search, Extract, Map, Crawl, Extract Template, Web Search Agent). Nimble's own docs steer toward the plugin — the demo's first 60s shows `/plugin install nimble`, then the MCP tool call. The built seam is the MCP adapter (direct tool calls). Nimble's zero-maintenance pipeline is the villain's *narrative* accomplice — it runs silently and never notices drift — but no pipeline is configured in this build; Veto is the witness.
2. **Pin** — at ingest, every fact pinned: `{fact, sha256, fetched_at}`. Agent cites pins, not pages. The cite-pins rule ships as a one-file Agent Skill in the repo (Nimble's own publish format) — "best use" on two surfaces.
3. **Reason** — a Liquid LFM2.5 agent (`LFM2.5-1.2B-Instruct` on-device; `liquid/lfm-2.5-2.6b:free` via OpenRouter as fallback — see C2) reasons against the pinned basis and writes the pin-cited report. Generator/verifier: the agent proposes, the deterministic gate disposes — the agent is never inside the gate, and the trust guarantee never depends on it. Deterministic template report remains as fallback if the model call fails.
4. **Revalidate (deterministic gate, no LLM inside it)** — before ship: re-fetch → re-hash → compare. Pure function.
   - Clean → ship with inspectable pins.
   - Drifted → flag; re-base on new pins or disclose the drift. Never silently ship the old basis.
   - Unreachable → **fail closed**: refuse rather than ship on stale pins.
5. **Refuse with receipt** — every refusal emits one JSON line: `{refused_at, drifted_facts, pin_hashes, basis_window}`.

## Evidence (counts, not adjectives)
`N facts pinned · M drifted-and-flagged · 0 shipped contradictions`
Strongest objection, answered: "why not just re-fetch?" — re-fetch returns new data, not the basis the analysis used. You need the pinned basis *plus* what changed.

## Metrics (metric-first)

**North star — contradiction-free ship rate.**
`1 − (contradictions shipped ÷ reports shipped)`, target 100%.
The product's job is refusal; the north star measures the outcome the user cares about:
every shipped artifact is contradiction-free against its pinned basis.
Demo readout: `0 shipped contradictions`.

**Counter metric — false refusal rate.**
`(refusals on a clean basis ÷ total refusals)`, target 0%.
This is what keeps the north star honest. Maximizing the north star alone has a degenerate
strategy: refuse everything. The counter metric punishes a paranoid gate. Together they pin
the product at exactly one behavior: refuse the drifts, ship the clean.

**Leading inputs** (feed the pair): pin coverage (% of factual claims backed by a pin),
drift recall (% of injected drifts caught before ship). The red proofs measure these
directly — R4/R5 test drift recall, R6 tests the false-refusal boundary, R2 tests pin integrity.

**Operational guardrail:** gate latency p95 stays small — a gate nobody can afford is a gate
nobody runs. The demo's < 3 min full arc is the budget.

## Demo script (theatrical beats)
1. **First 60s:** `/plugin install nimble`, then Nimble MCP tools live — fetch running through the MCP server on screen. The judge sees Yaniv's surface (the plugin his team ships), not just Anthropic's protocol.
2. **Villain reveal:** the report on screen, citations highlighted, prices don't match.
3. **Refusal:** big REFUSED — the agent declines to ship the contradiction; receipt shown.
4. **Mata line:** "The brief cited six cases. None of them existed."

## Scope: in
Nimble MCP + plugin, pin store, cite-pins Agent Skill (one file, Nimble's publish format), Liquid agent report writer (deterministic template fallback), deterministic gate, fail-closed, refusal receipts, Tinybird evidence read path (datasource + pipe serving the counts API; local files stay source of truth, offline fallback), counts, demo script above.

## Scope: out (do not build)
Dashboards, Nimble pipeline configuration, second sponsor pitch, ML metrics, any change to Nimble itself. Build uses Nimble + Tinybird + Liquid where each fits naturally; pitch is single-lane Nimble only — Tinybird and Liquid are never mentioned on stage.

## Calibration rules
- Never claim a real customer agent broke. The villain is the segment's daily world, not a claimed incident.
- Nimble's KYC story is marketing context, not evidence of harm.
- No unmeasured efficiency claims (no "10x faster", no token math without measurement).

## Pre-registration (before building)
Hypothesis: Yaniv rewards (a) his data-failure thesis made tangible, (b) depth on Nimble's agent-native surfaces — the plugin install on screen, MCP tools in the first 60s, the cite-pins rule as a one-file Agent Skill in his team's format, (c) production-robustness thinking (fail-closed, deterministic gate). The demo's winning moment is the refusal, not the recall. Pre-registered seam defenses: grounding is fetch-time, Veto is ship-time; /monitor watches the world, Veto watches the report's basis; our drift is world drift, never pipeline drift. We will score the outcome against this after the event.

## Build phases (rough — build-prompt packages these into paste blocks)
- P0: Nimble MCP wiring + one pipeline fetch, visible on screen.
- P1: Pin store (hash + timestamp) + cite-pins-only agent loop.
- P2: Deterministic revalidate gate + fail-closed branch + refusal receipts.
- P3: Villain scenario (6pm/9pm/6am price drift) + evidence counts + demo rehearsal.
- Each phase lands only on Devansh's go-word; verify before advancing.

## Acceptance criteria
- [ ] Fetch visibly runs through Nimble MCP in the first 60s.
- [ ] Every cited fact resolves to a pin (hash + timestamp); no bare URLs in the report.
- [ ] Simulated drift produces a flagged refusal + JSON receipt, on screen.
- [ ] Unreachable revalidation produces refusal, not a stale ship.
- [ ] Counts displayed: N pinned, M flagged, 0 contradictions — served via the Tinybird pipe; identical counts computable from local files with no network.
- [ ] No out-of-scope items built.

## Budget
Default build-turn budget ~15k tokens unless Devansh raises it. Cost is first-class: report spend with every land.
