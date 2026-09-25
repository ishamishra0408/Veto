# Veto

**Everyone demos what their agent remembers. We demo what ours refuses.**

**Veto is the ship lock at the end of any long-horizon agent's cycle:** whatever the agent produces — a report, a PR, a plan — cites pinned facts, and Veto won't let it ship if they've moved. It refuses, re-plans, and ships the truth.

**An AI pricing agent fetches competitor prices at 6pm, works overnight, and ships a report at 6am. If a price moved at 9pm, the report recommends matching a price that no longer exists. The model did everything right. The data moved. Veto stops that report before it ships.**

**Live data:** Nimble MCP (`nimble_extract`) on 5 real Amazon product pages · **one command:** `bash veto/demo.sh --real`

**Result:** **0 shipped contradictions** · injected drift caught on every run · Amazon changed a pinned fact **on its own** (nothing injected) on most live runs, and Veto refused · a second, on-device Liquid extractor corroborated **10 of 10** live pages before pinning · 23 of 23 scripted red proofs pass

## The problem

Trust is a property of the moment of action, not the moment of retrieval.

Grounding checks a claim while the agent writes it. Nothing checks it again when the work ships, hours later. A price, a stock status or a seller can change in between, and the report still cites it as current. A retailer repricing against that report is pricing against a ghost.

The mature-domain mirror is *Mata v. Avianca* (2023): the brief cited six cases; none existed. Nobody checked the citations at the moment they were relied on.

## What it does

The agent runs a multi-step plan and every step is logged to `plan.json`:

| Step | Kind | What happens |
|---|---|---|
| P1 | plan | Decompose the goal ("recommend a price that undercuts the cheapest comparable competitor by 3%") into the facts it needs and the conclusions that follow |
| P2 | act | Collect the competitor pages through Nimble MCP |
| P3 | observe | Two extractors must agree before a fact is pinned; held pages re-plan the comparable set |
| P4–P5 | reason | Comparables → anchor → recommended price — every conclusion records the pins it rests on |
| P6 | act | Draft the report |
| P7 | observe | The gate re-fetches and re-hashes every cited fact |
| P8 | correct | **Impact analysis** — a drift breaks exactly the conclusions that cite the changed pin (the rest still hold) → re-pin → recompute → disclose as `[was-pin:]` → re-gate → ship |

Because the plan is a dependency graph from conclusions to pins, the agent never re-reads its history to recover: it carries 25 small pins, and a change tells it precisely which conclusions to redo.


1. **Collect** — the agent fetches each page through Nimble's MCP server (`initialize → tools/list → tools/call nimble_extract`), US storefront, all pages in parallel.
2. **Pin** — every fact (title, price, stock, rating, seller) is stored with its sha256 and fetch time. The hash is the pin's identity, like a git object. **Two independent extractors must agree first:** the deterministic parser and Liquid's extraction model (`LFM2-1.2B-Extract`, running **on-device** via Ollama) each read the page; if they disagree, the page is held — nothing from it is pinned or cited.
3. **Reason** — the report cites pins, never pages. Liquid `LFM2.5-1.2B-Instruct` (on-device) writes the analysis from pinned facts only, as JSON claims. A deterministic checker repairs a missing citation only when a number matches exactly one fact of a product the claim names, and drops any claim that is uncited, cites a pin that doesn't exist, contains a URL, uses a number its cited facts don't contain, or names a product it doesn't cite.
4. **Revalidate** — before ship, a gate with no model inside it re-fetches every cited source, re-hashes each fact and compares.
5. **Refuse with a receipt** — `CLEAN` ships. `DRIFTED` refuses (or re-bases on fresh pins and discloses the change). `UNREACHABLE` refuses: fail closed, never ship on stale pins. Every refusal writes one JSON line: `{refused_at, reason, drifted_facts, error, pin_hashes, basis_window, explanation}` — the explanation is a plain-English *why*, built deterministically from the receipt so it is always true.
6. **Measure** — every event streams to Tinybird as it happens. Pipes serve the evidence counts (must equal local counts; offline falls back to local), the gate's p95 latency, and **fact volatility across every live run** — which facts move most, so you know what to re-check first.

It decides on the **pinned basis**, not on the latest page: re-fetching alone returns new data, not the data the analysis used. You need the basis *plus* what changed.

## Result

| Run | World between fetch and ship | Verdict | Receipt |
|---|---|---|---|
| Mock, night 1 | unchanged | **CLEAN** — ships | — |
| Mock, night 2 | the anchor competitor's price −15% (injected) | **REFUSED** (DRIFTED) → **re-planned, re-based, SHIPPED** — recommendation $126.09 → $107.18 | old ≠ new hash |
| Mock, outage | every fetch fails | **REFUSED** (UNREACHABLE) — `report.md` byte-identical | error recorded |
| Live, night 1 (×4) | **nothing injected** — Amazon changed price / stock / seller on its own | **REFUSED** (DRIFTED), 4 of 4 | [`evidence/`](evidence/live-run-2026-09-25) |
| Live, night 2 (×4) | −15% injected on top of live data | **REFUSED** (DRIFTED), 4 of 4 | [`evidence/`](evidence/live-run-2026-09-25) |

**Shipped contradictions: 0.** The counter metric keeps that honest — a gate that refuses everything also ships zero contradictions, so false refusals are counted separately: **0** on the mock clean path. On live runs night 1 rarely ships, because Amazon's page genuinely moves; those refusals are counted as *unforced drift*, not as false alarms.

The Liquid agent, live: in every live run we inspected (3 of 3) it invented pin IDs or borrowed another product's price; the checker dropped those sentences before they reached a draft (e.g. 3 kept · 1 dropped, "cites a pin not in the basis").

Every claim above is a red proof — an adversarial test that the mechanism cannot be fooled, not that the code runs:

| Proof | Attack | Must show |
|---|---|---|
| R1 | Name the mock outside the adapter seam | nothing |
| R2 | Flip one character of a pinned fact | `MISSING`, exit 1; real veto byte-identical |
| R3 | Look for a URL in the report | 0 |
| R4 / R5 / R6 | Drift / outage / clean world | REFUSED / REFUSED + report untouched / CLEAN |
| R7 | Look for a model inside the gate | nothing |
| R8 | Cross-check receipt hashes against the veto | all match, inside the run window |
| G1 / G2 | Ship without the gate / re-base after drift | impossible / disclosed + verifies |
| R9 / R11 / R12 | Repeat the demo / time it / check the counter is computed | identical verdicts / < 3 min / K = CLEAN count |
| R10 | Nimble adapter vs mock shape | exact match (also live) |
| R13 / R14 | Nimble visible in the first 60s / live pins verify | tool calls on screen / 25 of 25 |
| R15 | Agent Skill describes only what is built | every pin, file and field resolves |
| R16 | Tinybird counts vs local counts; network blocked | identical; offline exits 0 |
| R17 | Forge `[pin:deadbeef0000]` into an agent report | `MISSING` + REFUSED, nothing ships |
| R18 | Second extractor disagrees on one page | that page is never pinned; gate imports no extractor |
| R19 | Smuggle a claim into the refusal explanation | dropped; live explanation cites only the drifted facts |
| R20 | Stream events, no sync | all 25 per-fact checks reach Tinybird; volatility ranks the drifted fact |
| R21 | Ship a report citing the injected fact (broken gate) | counted as a shipped contradiction — the north star can't hide it |
| R22 | Launder claims through citation repair | invented price, cross-product price, one-sided comparison all dropped |
| R23 | Drift the anchor competitor's price | exactly the conclusions citing it break; the recommendation is recomputed; the re-based report verifies |

## Run locally

Needs Node 22.18+ (runs TypeScript directly; built-in SQLite).

```bash
git clone https://github.com/ishamishra0408/Veto && cd Veto/veto
npm install && npm run typecheck
cd .. && bash veto/redproofs_p1.sh && bash veto/redproofs_p2.sh && bash veto/redproofs_p3.sh   # no keys needed
bash veto/demo.sh                        # mock, offline, full arc
```

Live run — put keys in `veto/.env` (gitignored):

```bash
NIMBLE_API_KEY=…                          # Nimble MCP, required for --real
VETO_LIQUID_URL=http://localhost:11434/v1/chat/completions   # Liquid on-device via Ollama (optional)
OPENROUTER_API_KEY=…                      # or Liquid via OpenRouter (optional; falls back to template)
TINYBIRD_TOKEN=…  TINYBIRD_HOST=…         # evidence read path (optional; falls back to local)
bash veto/demo.sh --real                 # ~60-100s

# on-device Liquid (once): the two models from huggingface.co/LiquidAI, 730 MB each
ollama pull hf.co/LiquidAI/LFM2-1.2B-Extract-GGUF:Q4_K_M
ollama pull hf.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF:Q4_K_M
```

## Repo map

```
veto/            Veto (TypeScript, Node 22)
  adapters.ts       fetch seam: mock + Nimble MCP (JSON-RPC over Streamable HTTP)
  pins.ts           content-addressed pin store (SQLite)
  report.ts         pin-cited report; agent.ts = Liquid writer + claim checker; extract.ts = L1 two-extractor agreement
  liquid.ts         one Liquid client: on-device (Ollama) or OpenRouter
  gate.ts           deterministic revalidation — no model inside
  ship.ts           the only writer of report.md; receipts.ts, evidence.ts
  scenario.ts       the multi-step plan: 6pm → 9pm → 6am villain → self-correct; planner.ts, simulate.ts, worlds.ts
  skill/SKILL.md    cite-pins rule as an Agent Skill (Nimble format)
  tinybird/         datasource + pipes: evidence counts, gate p95, fact volatility; stream.ts = live events
  redproofs_p*.sh   the red proofs
evidence/         captured live runs, each folder stating what it is and is not
SPEC.md           frozen spec; BUILD_PLAN.md, SPONSOR_FEATURES.md, FLOW.d2
```

Built with **Nimble** (MCP server, `nimble_extract`, Agent Skill format), **Liquid AI** (on-device `LFM2-1.2B-Extract` + `LFM2.5-1.2B-Instruct`), **Tinybird** (live event stream + pipes: counts, gate p95, fact volatility).

Built for the Long Horizon Agents Hackathon 2026 by Isha Mishra and Devansh Pathak, with Claude Code.
