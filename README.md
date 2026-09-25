# Pinned Evidence Vault

**Everyone demos what their agent remembers. We demo what ours refuses.**

**An AI pricing agent fetches competitor prices at 6pm, works overnight, and ships a report at 6am. If a price moved at 9pm, the report recommends matching a price that no longer exists. The model did everything right. The data moved. The Vault stops that report before it ships.**

**Live data:** Nimble MCP (`nimble_extract`) on 5 real Amazon product pages · **one command:** `bash vault/demo.sh --real`

**Result:** **0 shipped contradictions** · injected drift caught on every run · on **4 of 4** complete live runs Amazon changed a pinned fact **on its own** (nothing injected) and the Vault refused · 17 of 17 red proofs pass

## The problem

Trust is a property of the moment of action, not the moment of retrieval.

Grounding checks a claim while the agent writes it. Nothing checks it again when the work ships, hours later. A price, a stock status or a seller can change in between, and the report still cites it as current. A retailer repricing against that report is pricing against a ghost.

The mature-domain mirror is *Mata v. Avianca* (2023): the brief cited six cases; none existed. Nobody checked the citations at the moment they were relied on.

## What it does

1. **Collect** — the agent fetches each page through Nimble's MCP server (`initialize → tools/list → tools/call nimble_extract`), US storefront, all pages in parallel.
2. **Pin** — every fact (title, price, stock, rating, seller) is stored with its sha256 and fetch time. The hash is the pin's identity, like a git object.
3. **Reason** — the report cites pins, never pages. A Liquid LFM2.5 agent writes the analysis from pinned facts only; a deterministic checker drops any sentence that is uncited, cites a pin that doesn't exist, contains a URL, or uses a number its cited facts don't contain.
4. **Revalidate** — before ship, a gate with no model inside it re-fetches every cited source, re-hashes each fact and compares.
5. **Refuse with a receipt** — `CLEAN` ships. `DRIFTED` refuses (or re-bases on fresh pins and discloses the change). `UNREACHABLE` refuses: fail closed, never ship on stale pins. Every refusal writes one JSON line: `{refused_at, reason, drifted_facts, error, pin_hashes, basis_window}`.

It decides on the **pinned basis**, not on the latest page: re-fetching alone returns new data, not the data the analysis used. You need the basis *plus* what changed.

## Result

| Run | World between fetch and ship | Verdict | Receipt |
|---|---|---|---|
| Mock, night 1 | unchanged | **CLEAN** — ships | — |
| Mock, night 2 | competitor price −15% (injected) | **REFUSED** (DRIFTED) | old ≠ new hash |
| Mock, outage | every fetch fails | **REFUSED** (UNREACHABLE) — `report.md` byte-identical | error recorded |
| Live, night 1 (×4) | **nothing injected** — Amazon changed price / stock / seller on its own | **REFUSED** (DRIFTED), 4 of 4 | [`evidence/`](evidence/live-run-2026-09-25) |
| Live, night 2 (×4) | −15% injected on top of live data | **REFUSED** (DRIFTED), 4 of 4 | [`evidence/`](evidence/live-run-2026-09-25) |

**Shipped contradictions: 0.** The counter metric keeps that honest — a gate that refuses everything also ships zero contradictions, so false refusals are counted separately: **0** on the mock clean path. On live runs night 1 rarely ships, because Amazon's page genuinely moves; those refusals are counted as *unforced drift*, not as false alarms.

The Liquid agent, live: in every live run we inspected (3 of 3) it invented pin IDs or borrowed another product's price; the checker dropped those sentences before they reached a draft (e.g. 3 kept · 1 dropped, "cites a pin not in the basis").

Every claim above is a red proof — an adversarial test that the mechanism cannot be fooled, not that the code runs:

| Proof | Attack | Must show |
|---|---|---|
| R1 | Name the mock outside the adapter seam | nothing |
| R2 | Flip one character of a pinned fact | `MISSING`, exit 1; real vault byte-identical |
| R3 | Look for a URL in the report | 0 |
| R4 / R5 / R6 | Drift / outage / clean world | REFUSED / REFUSED + report untouched / CLEAN |
| R7 | Look for a model inside the gate | nothing |
| R8 | Cross-check receipt hashes against the vault | all match, inside the run window |
| G1 / G2 | Ship without the gate / re-base after drift | impossible / disclosed + verifies |
| R9 / R11 / R12 | Repeat the demo / time it / check the counter is computed | identical verdicts / < 3 min / K = CLEAN count |
| R10 | Nimble adapter vs mock shape | exact match (also live) |
| R13 / R14 | Nimble visible in the first 60s / live pins verify | tool calls on screen / 25 of 25 |
| R15 | Agent Skill describes only what is built | every pin, file and field resolves |
| R16 | Tinybird counts vs local counts; network blocked | identical; offline exits 0 |
| R17 | Forge `[pin:deadbeef0000]` into an agent report | `MISSING` + REFUSED, nothing ships |

## Run locally

Needs Node 22.18+ (runs TypeScript directly; built-in SQLite).

```bash
git clone https://github.com/ishamishra0408/Vault && cd Vault/vault
npm install && npm run typecheck
cd .. && bash vault/redproofs_p1.sh && bash vault/redproofs_p2.sh && bash vault/redproofs_p3.sh   # no keys needed
bash vault/demo.sh                        # mock, offline, full arc
```

Live run — put keys in `vault/.env` (gitignored):

```bash
NIMBLE_API_KEY=…                          # Nimble MCP, required for --real
OPENROUTER_API_KEY=…                      # Liquid agent (optional; falls back to template)
TINYBIRD_TOKEN=…  TINYBIRD_HOST=…         # evidence read path (optional; falls back to local)
bash vault/demo.sh --real                 # ~60s
```

## Repo map

```
vault/            the Vault (TypeScript, Node 22)
  adapters.ts       fetch seam: mock + Nimble MCP (JSON-RPC over Streamable HTTP)
  pins.ts           content-addressed pin store (SQLite)
  report.ts         pin-cited report; agent.ts = Liquid writer + claim checker
  gate.ts           deterministic revalidation — no model inside
  ship.ts           the only writer of report.md; receipts.ts, evidence.ts
  scenario.ts       6pm → 9pm → 6am villain; simulate.ts, worlds.ts
  skill/SKILL.md    cite-pins rule as an Agent Skill (Nimble format)
  tinybird/         datasource + pipe serving the evidence counts
  redproofs_p*.sh   the red proofs
evidence/         captured live runs, each folder stating what it is and is not
SPEC.md           frozen spec; BUILD_PLAN.md, SPONSOR_FEATURES.md, FLOW.d2
```

Built with **Nimble** (MCP server, `nimble_extract`, Agent Skill format), **Liquid AI** (LFM2.5 report writer), **Tinybird** (evidence events + pipe API).

Built for the Long Horizon Agents Hackathon 2026 by Isha Mishra and Devansh Pathak, with Claude Code.
Work predating the event is tagged `pre-event`.
