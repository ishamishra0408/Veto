// One Liquid client for every model call in Veto. Default: OpenRouter (`liquid/lfm-2.5-2.6b:free`).
// On-device: set VETO_LIQUID_URL to any OpenAI-compatible local server (llama.cpp / Ollama running an LFM
// from huggingface.co/LiquidAI) and VETO_AGENT_MODEL to its model name — no other code changes.
const LOCAL_URL = process.env.VETO_LIQUID_URL;
export const LIQUID_WHERE = LOCAL_URL ? "on-device" : "OpenRouter";
// Writer (analysis + why-blocked) and extractor (L1). On-device defaults: Liquid's own GGUFs from
// huggingface.co/LiquidAI served by Ollama; the extractor is the extraction-tuned Nano.
export const LIQUID_MODEL = process.env.VETO_AGENT_MODEL ??
  (LOCAL_URL ? "hf.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF:Q4_K_M" : "liquid/lfm-2.5-2.6b:free");
export const EXTRACT_MODEL = process.env.VETO_EXTRACT_MODEL ??
  (LOCAL_URL ? "hf.co/LiquidAI/LFM2-1.2B-Extract-GGUF:Q4_K_M" : LIQUID_MODEL);

let quotaHit = false; // circuit breaker: after a daily-quota 429, skip further calls in this run

export async function liquidChat(system: string, user: string, maxTokens = 2000, model = LIQUID_MODEL): Promise<string> {
  if (process.env.VETO_AGENT === "off") throw new Error("agent off (VETO_AGENT=off)");
  if (quotaHit) throw new Error("daily quota reached (skipped)");
  const key = process.env.OPENROUTER_API_KEY;
  if (!LOCAL_URL && !key) throw new Error("no OPENROUTER_API_KEY and no VETO_LIQUID_URL");
  const res = await fetch(LOCAL_URL ?? "https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key && !LOCAL_URL ? { Authorization: `Bearer ${key}` } : {}), "X-Title": "Veto" },
    body: JSON.stringify({
      model, temperature: 0, max_tokens: maxTokens,
      // LFM2.5 on OpenRouter reasons first; at default effort it exhausts the budget before answering.
      ...(LOCAL_URL ? {} : { reasoning: { effort: "low" } }),
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(Number(process.env.VETO_AGENT_TIMEOUT_MS ?? 20_000)),
  });
  const body: any = await res.json(); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (res.status === 429 && /per-day/.test(JSON.stringify(body))) { quotaHit = true; throw new Error("OpenRouter free daily quota reached"); }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 160)}`);
  return body.choices?.[0]?.message?.content ?? "";
}
