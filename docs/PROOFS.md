# Veto — red proofs

Every claim in the [README](../README.md) is backed by a red proof: an adversarial test that the mechanism **cannot be fooled**, not that the code runs. Most run on the mock world (fixed copies of the five product pages in `veto/pages.txt`), so each attack is exact and every run gives the same answer; live Amazon behaviour is shown by the captured runs in [`evidence/`](../evidence/).

```bash
bash veto/redproofs_p1.sh && bash veto/redproofs_p2.sh && bash veto/redproofs_p3.sh
```
R16 and R20 need the Tinybird keys; R19's second half runs with Liquid running (Ollama or OpenRouter); R13/R14 are checked on every `demo.sh --real` run. Scripts assume macOS (`stat -f`, `sed -i ''`).

| Proof | Attack | Must show |
|---|---|---|
| R1 | Name the mock outside the adapter seam | nothing |
| R2 | Flip one character of a pinned fact | `MISSING`, exit 1; the real `pins.db` byte-identical |
| R3 | Look for a URL in the report | 0 |
| R4 / R5 / R6 | Drift / outage / clean world | REFUSED / REFUSED + report untouched / CLEAN |
| R7 | Look for a model inside the gate | nothing |
| R8 | Cross-check receipt hashes against `pins.db` | all match, inside the run window |
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
