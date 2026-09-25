# Veto

**Everyone demos what their agent remembers. We demo what ours refuses.**

**Veto is the ship lock at the end of a long-horizon agent's cycle:** the agent's output cites pinned facts, and Veto won't let it ship if those facts have moved. It refuses with a receipt, re-plans around what changed, and ships only what still holds. Demonstrated here on a pricing report; the same lock applies to any output that cites facts.

**An AI pricing agent fetches competitor prices at 6pm, works overnight, and ships a recommendation at 6am. If a price moved at 9pm, the recommendation matches a price that no longer exists. The model did everything right. The data moved. Veto stops that report before it ships.**

**Live data:** Nimble MCP (`nimble_extract` + `nimble_search`) on real Amazon product pages · **one command:** `bash veto/demo.sh --real`

**Result (captured in [`evidence/`](evidence/)):** in the final live run, night 1 refused on unforced drift, re-planned and **shipped a re-based report (25/25 pins verify)**; night 2 caught the injected −15% drop and **refused** when Amazon kept moving. A lost competitor page was **replaced via `nimble_search`**. 0 of the reports that shipped cite a changed fact. 30 scripted red proofs pass locally (macOS; 3 need API keys).

## The problem

Trust is a property of the moment of action, not the moment of retrieval.

Grounding checks a claim while the agent writes it. Nothing checks it again when the work ships, hours later. A price, a stock status or a seller can change in between, and the report still cites it as current. Re-fetching at ship time isn't enough on its own: it gives you the new world, not which of the agent's *conclusions* were built on the old one. Veto keeps the pinned basis *and* the diff.

## What it does

The agent runs a multi-step plan, logged to `plan.json` (steps are fixed; branches depend on what the agent observes):

| Step | Kind | What happens |
|---|---|---|
| P1 | plan | Decompose the goal ("recommend a price that undercuts the cheapest comparable competitor by 3%") into facts needed and conclusions that follow |
| P2 | act | Fetch the competitor pages through Nimble MCP (`nimble_extract`) |
| P3 | observe | **Two extractors must agree before a fact is pinned** — a deterministic parser and Liquid `LFM2-1.2B-Extract` (on-device), both reading the same page. A lost page (unreachable, or no extractable price — values are never invented) is **re-planned: `nimble_search` finds a comparable listing**, which is corroborated and pinned |
| P4–P5 | reason | Comparables → anchor → recommended price; every conclusion records the pins it rests on |
| P6 | act | Draft the report; Liquid `LFM2.5-1.2B-Instruct` (on-device) adds analysis as JSON claims, each cite-checked |
| P7 | observe | The gate re-fetches and re-hashes every cited fact (no model inside). On drift, a **confirm fetch** classifies each change: *moved* (holds) or *flap* (the pinned value came back) |
| P8 | correct | **Impact analysis** names exactly the conclusions that cite a changed pin → **targeted re-base**: re-fetch only the drifted pages, reuse the rest from their pins, recompute, disclose the old values as `[was-pin:]`, re-gate, ship. A fact that keeps changing while being checked is marked **unstable** and displayed without being relied on. Up to 3 attempts, then refuse |

Every fact is pinned as `{fact, sha256, fetched_at}` — content-addressed, like a git object — and every sighting is recorded, so a receipt's `basis_window` is when *this* basis was observed. Every refusal writes a receipt: `{refused_at, reason, drifted_facts, error, pin_hashes, basis_window, explanation, confirm}`; every ship writes `{shipped_at, pin_hashes, basis_window}`.

**What the checks do and don't do.** The claim checker verifies *citations and numbers*: each claim cites real pins; each number is a whole-token value of a cited fact; each field it talks about (price, stock, rating, seller) is cited; products it names are cited; price comparisons match the cited prices; speculation ("will drop next week") is dropped. It does not judge adjectives ("great value"). The gate protects the basis, not the prose.

## Result

| Run | World between fetch and ship | Verdict | Evidence |
|---|---|---|---|
| Mock, night 1 | unchanged | **CLEAN** — ships | [`mock-run`](evidence/mock-run-2026-09-25) |
| Mock, night 2 | anchor competitor −15% (injected) | **REFUSED** → re-based (re-fetched 1 of 5 pages) → **SHIPPED**, recommendation $126.09 → $107.18 | R23, R26 |
| Mock, outage | every fetch fails | **REFUSED** (UNREACHABLE), `report.md` byte-identical | [`mock-run`](evidence/mock-run-2026-09-25) |
| Live, night 1 | a competitor page lost (simulated) + no price injected; Amazon's facts moved/flapped on their own | lost page **replaced via `nimble_search`**; **REFUSED** → unstable facts not relied on → re-based → **SHIPPED**, 25/25 verify | [`live-run-final`](evidence/live-run-2026-09-25-final) |
| Live, night 2 | anchor −15% injected on live data | **REFUSED**; 2 re-base attempts, Amazon kept moving → **refused** (fail closed) | [`live-run-final`](evidence/live-run-2026-09-25-final) |

Earlier live runs: [`live-run-2026-09-25`](evidence/live-run-2026-09-25) (unforced drift refused, both nights) and [`live-run-2026-09-25-trace`](evidence/live-run-2026-09-25-trace) (full MCP trace).

**Metrics, honestly.** *Shipped contradiction* = a shipped, non-re-based report citing the exact fact the injector changed (ground truth from the injection, not the gate). *False refusal* = a refusal on an unchanged mock world, or a live refusal where every drifted fact **flapped back** on the confirm fetch — measurable live (the final run recorded 1). On live data a refusal without injection is *unforced drift*: Amazon's buy box (the price and seller a customer sees) genuinely rotates between fetches seconds apart.

Every claim above is a red proof — an adversarial test that the mechanism cannot be fooled:

| Proof | Attack | Must show |
|---|---|---|
| R1 | Name the mock outside the adapter seam | nothing |
| R2 | Flip one character of a pinned fact | `MISSING`, exit 1; real vault byte-identical |
| R3 | Look for a URL in the report | 0 |
| R4 / R5 / R6 | Drift / outage / clean world | REFUSED / REFUSED + report untouched / CLEAN |
| R7 | Look for a model inside the gate | nothing |
| R8 | Cross-check receipt hashes against the vault | all match, inside the run window |
| G1 / G2 | Ship without the gate / re-base after drift | impossible / disclosed + verifies |
| R9 / R11 / R12 | Repeat the demo / time it / counter computed | identical verdicts, refused → re-based → shipped / < 3 min (mock) / K = CLEAN count |
| R10 | Nimble adapter vs mock shape | exact match (also live) |
| R13 / R14 | Nimble visible in the first 60s / live pins verify | tool calls on screen / all resolve |
| R15 | Agent Skill describes only what is built | every pin, file and field resolves |
| R16 | Tinybird counts vs local counts; network blocked | identical; offline exits 0 |
| R17 | Forge `[pin:deadbeef0000]` into an agent report | `MISSING` + REFUSED |
| R18 | Second extractor disagrees on one page | never pinned; gate imports no extractor |
| R19 | Smuggle a claim into the refusal explanation | dropped |
| R20 | Stream events, no sync | all per-fact checks reach Tinybird; volatility ranks the drifted fact |
| R21 | Ship a report citing the injected fact (broken gate) | counted as a shipped contradiction |
| R22 / R24 | Launder claims: invented or cross-product price, partial numbers ("29" in 298.00), rating boilerplate ("5 star"), reversed comparison, speculation, wrong-field citation | all dropped; true claims kept |
| R23 | Drift the anchor competitor | exactly the conclusions citing it break; recommendation recomputed |
| R25 | Lose a competitor page at 18:00 | search finds a comparable; pinned, cited, ships |
| R26 | Re-base after one page drifts | re-fetches 1 of 5 pages; re-gated CLEAN |
| R27 | A source that flaps back | classified *flap*; counted as a false refusal |
| R28 | Pin a fact twice, then drift | `basis_window` is the second observation |
| R29 | Parser-only page, then corroborated | never relabelled; "re-used" only if agreed |
| R30 | A seller that changes on every fetch | marked unstable, not relied on; report still ships |

## Run locally

Needs Node 22.18+ (runs TypeScript directly; built-in SQLite) and the `sqlite3` CLI. Proof scripts are written for macOS (`stat -f`, `sed -i ''`).

```bash
git clone https://github.com/ishamishra0408/Veto && cd Veto/veto
npm install && npm run typecheck
cd .. && bash veto/redproofs_p1.sh && bash veto/redproofs_p2.sh && bash veto/redproofs_p3.sh   # R16, R20 and live R19 need keys
bash veto/demo.sh                          # mock, offline, full arc
```

Live run — put keys in `veto/.env` (gitignored):

```bash
NIMBLE_API_KEY=…                                             # Nimble MCP, required for --real
VETO_LIQUID_URL=http://localhost:11434/v1/chat/completions   # Liquid on-device via Ollama (optional)
OPENROUTER_API_KEY=…                                         # or Liquid via OpenRouter (optional; template fallback)
TINYBIRD_TOKEN=…  TINYBIRD_HOST=…                            # evidence read path (optional; local fallback)
bash veto/demo.sh --real            # both nights, ~4 min live
bash veto/demo.sh --real --night2   # villain night only, ~2 min

ollama pull hf.co/LiquidAI/LFM2-1.2B-Extract-GGUF:Q4_K_M       # on-device Liquid, 730 MB each
ollama pull hf.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF:Q4_K_M
```

## Repo map

```
veto/             Veto (TypeScript, Node 22)
  adapters.ts       fetch seam: mock + Nimble MCP (JSON-RPC over Streamable HTTP; extract + search; trace)
  pins.ts           content-addressed pins, observations, per-pin corroboration (SQLite)
  report.ts         report, recommendation, conclusion graph, re-plan of lost pages
  agent.ts          Liquid writer + claim checker + citation repair; extract.ts = L1 two-extractor agreement
  liquid.ts         one Liquid client: on-device (Ollama) or OpenRouter
  gate.ts           deterministic revalidation — no model inside
  ship.ts           the only writer of report.md; confirm fetch, receipts, targeted re-base, unstable facts
  planner.ts        plan.json; scenario.ts = the 6pm → 9pm → 6am arc; simulate.ts, worlds.ts
  evidence.ts       metrics; tinybird.ts + stream.ts + tinybird/ = live events and pipes
  skill/SKILL.md    cite-pins rule as an Agent Skill (Nimble format)
  redproofs_p*.sh   the red proofs
evidence/         captured runs, each folder stating what it is and is not
SPEC.md           frozen spec; BUILD_PLAN.md, SPONSOR_FEATURES.md, FLOW.d2
```

Built with **Nimble** (MCP server: `nimble_extract`, `nimble_search`; Agent Skill format), **Liquid AI** (on-device `LFM2-1.2B-Extract` + `LFM2.5-1.2B-Instruct`), **Tinybird** (live event stream + pipes: counts, gate p95, fact volatility).

Built for the Long Horizon Agents Hackathon 2026 by Isha Mishra and Devansh Pathak, with Claude Code.
