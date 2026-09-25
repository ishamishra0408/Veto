# Beats — Veto
Recorded video and live pitch follow this table. 3:30 target inside a 3–4 min slot; `demo.sh` itself < 3 min (R11).
Arc: recognition → open-loop stakes → curiosity → discomfort → structural aha → seam pre-empted → theme tie → mirror → take-home question.

| # | Beat | Script (spoken) | On screen | Time | Expected engagement |
|---|---|---|---|---|---|
| 1 | Recognition | "Most production AI failures are data failures. Not our line. Nimble's CEO, February." | Deck: TechCrunch capture, Knorovich highlighted | 0:00–0:20 | nods, it is their thesis |
| 2 | Open-loop stakes | "A pricing agent fetches at 6 pm, works overnight, ships at 6 am. At 9 pm one competitor drops 15 %. The model did everything right. The data moved." | Deck: timeline.d2 | 0:20–0:40 | the gap is obvious and unaddressed |
| 3 | Curiosity | "Here is the fetch, through Nimble's MCP server." | Terminal: `bash veto/demo.sh --real --night2`, `nimble_extract` calls in the trace, pins written | 0:40–1:15 | Nimble visible by 0:50 |
| 4 | Discomfort | "The 6 am report. Every claim cites a pin, not a page. Now the price moves." | Terminal: report.md, then the drift | 1:15–1:40 | they expect the ship |
| 5 | Structural aha | "The gate re-fetches, re-hashes, compares. No model inside it. REFUSED. Here is the receipt, and the plain-English why." | Terminal: REFUSED banner, receipt line with explanation | 1:40–2:10 | the refusal is the product |
| 5b | Self-correct | "The plan knows which conclusions rested on that price. It re-pins, recomputes the recommendation, discloses what changed, re-gates, and ships the truth." | Terminal: [plan impact], [plan P8 correct], re-based CLEAN, the two count lines | 2:10–2:35 | refuse is not the end; the agent self-corrects |
| 6 | Seam, pre-empted | "Nimble grounds the claim while the agent works. Veto verifies the basis when the work ships. Grounding is fetch-time. This is ship-time." | Deck: seam.d2, then the Sep 23 grounding capture | 2:40–2:55 | "we already ground" dies before it is asked |
| 7 | Theme tie | "This hackathon asked what persists and what gets discarded. The pinned basis persists. A drifted basis is refused, never silently discarded." | Deck: luma capture, one line | 2:55–3:05 | the general panel hears the theme answered |
| 8 | Mirror | "The brief cited six cases. None of them existed. That was a citation that was never true. Ours is a citation that was true at 6 pm." | Deck: NBC capture, judge's words highlighted | 3:05–3:20 | mechanism, not vibe |
| 9 | Take-home question | "What in your stack checks the basis at the moment of action, not the moment of retrieval?" | Deck: Yaniv's Sep 22 capture, then the final card | 3:20–3:45 | lingering question |

Switch points: deck → terminal at the end of beat 2 (0:40); terminal → deck at the end of beat 5b (2:40). Stage run is `bash veto/demo.sh --real --night2`, about 2 min; the full two-night arc is 260 s and is not what is recorded. Total about 3:45.
Reset between takes: `veto/demo.sh` resets pins.db, receipts.jsonl, runs.jsonl, ships.jsonl, mcp-trace.jsonl and plan.json itself.
Numbers spoken in beat 5 (N, M, K) are read off the terminal, never memorised.
Off-stage lines: the terminal will also print the Tinybird ingest and the OpenRouter model call. Neither is spoken and neither word is said on stage (spec: single-lane Nimble). The spoken lines above do not change.
