// Report-writing agent: Liquid LFM2.5 via OpenRouter. Generator/verifier — the agent proposes, the checks dispose.
// The agent sees ONLY pinned facts. Every sentence it writes is machine-checked before it can enter a draft;
// the gate still revalidates every cited pin before ship. The trust guarantee never depends on the model.
export const AGENT_MODEL = process.env.VAULT_AGENT_MODEL ?? "liquid/lfm-2.5-2.6b:free";
const trace = (msg: string) => process.stderr.write(`\x1b[35m[liquid agent]\x1b[0m ${msg}\n`);

export interface BasisFact { pin_id: string; fact: string } // fact = "<field> of <product title> is <value>"

export interface ClaimCheck { kept: string[]; dropped: { sentence: string; reason: string }[] }

const numbersIn = (s: string) => (s.replace(/\[pin:[0-9a-f]+\]/g, "").match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));

// Deterministic claim checker. A sentence survives only if: it cites >= 1 pin, every cited pin is in the
// basis, it contains no URL, and every number in it appears verbatim in the facts it cites.
export function checkClaims(text: string, basis: BasisFact[]): ClaimCheck {
  const byId = new Map(basis.map((b) => [b.pin_id, b.fact]));
  const out: ClaimCheck = { kept: [], dropped: [] };
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?](?:\s*\[pin:[0-9a-f]+\])*)\s+(?=[A-Z*-])/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const ids = [...s.matchAll(/\[pin:([0-9a-f]+)\]/g)].map((m) => m[1]);
    const facts = ids.map((id) => byId.get(id));
    const cited = facts.filter(Boolean).join(" ").replace(/,/g, "");
    let reason = "";
    if (/https?:|www\./i.test(s)) reason = "contains a URL";
    else if (!ids.length) reason = "uncited claim";
    else if (facts.some((f) => !f)) reason = `cites a pin not in the basis`;
    else { const bad = numbersIn(s).filter((n) => !cited.includes(n)); if (bad.length) reason = `number(s) ${bad.join(", ")} not in the cited facts`; }
    if (reason) out.dropped.push({ sentence: s, reason }); else out.kept.push(s);
  }
  return out;
}

// Returns verified sentences, or null when the agent is off/unavailable (caller keeps the template report).
export async function agentAnalysis(basis: BasisFact[]): Promise<ClaimCheck | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (process.env.VAULT_AGENT === "off" || !key) return null;
  const facts = basis.map((b) => `[pin:${b.pin_id}] ${b.fact}`).join("\n");
  const t0 = Date.now();
  trace(`${AGENT_MODEL} · reasoning over ${basis.length} pinned facts`);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-Title": "Pinned Evidence Vault" },
      body: JSON.stringify({
        model: AGENT_MODEL,
        temperature: 0,
        max_tokens: 2000,
        reasoning: { effort: "low" }, // LFM2.5 reasons first; at default effort it exhausts the budget before answering
        messages: [
          { role: "system", content:
            "You are a retail pricing analyst. You may use ONLY the pinned facts given. " +
            "Write 3 to 5 short sentences of competitive pricing analysis. " +
            "End EVERY sentence with the [pin:<id>] tag(s) of the facts it uses, copied exactly. " +
            "Copy numbers exactly as they appear in the facts; do not compute new numbers. No URLs. No other text." },
          { role: "user", content: `Pinned facts:\n${facts}` },
        ],
      }),
      signal: AbortSignal.timeout(Number(process.env.VAULT_AGENT_TIMEOUT_MS ?? 45_000)),
    });
    const body: any = await res.json(); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 160)}`);
    const text: string = body.choices?.[0]?.message?.content ?? "";
    const check = checkClaims(text, basis);
    trace(`  ← ${Date.now() - t0}ms · ${check.kept.length} claim(s) verified · ${check.dropped.length} dropped`);
    for (const d of check.dropped) trace(`    dropped (${d.reason}): ${d.sentence.slice(0, 90)}`);
    return check;
  } catch (e) {
    trace(`  unavailable (${(e as Error).message}) — deterministic template only`);
    return null;
  }
}
