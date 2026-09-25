// Tinybird evidence READ PATH. Never inside the gate; local pins.db / receipts.jsonl / runs.jsonl stay the truth.
// Sync is idempotent: every local event is re-sent with a stable event_id and the pipe dedups by (kind, event_id).
export interface Counts {
  pinned: number; drifted_flagged: number; shipped_contradictions: number;
  clean_shipped: number; false_refusals: number; unforced_refusals: number; gate_p95_ms: number;
}
export interface VetoEvent {
  session: string; kind: "pin" | "receipt" | "run" | "check"; event_id: string; ts: string;
  n_drifted: number; verdict: string; mode: string; shipped: number; rebased: number;
  adapter: string; gate_ms: number; url: string; field: string; drifted: number; false_refusal: number;
}

export const chTime = (iso: string) => iso.replace("T", " ").replace("Z", ""); // DateTime64(3) text form

export async function remoteCounts(events: VetoEvent[], session: string): Promise<Counts> {
  const host = process.env.TINYBIRD_HOST, token = process.env.TINYBIRD_TOKEN;
  if (!host || !token) throw new Error("TINYBIRD_HOST / TINYBIRD_TOKEN not set");
  const auth = { Authorization: `Bearer ${token}` };
  const timeout = () => AbortSignal.timeout(Number(process.env.TINYBIRD_TIMEOUT_MS ?? 10_000));
  if (events.length) {
    const body = events.map((e) => JSON.stringify({ ...e, ts: chTime(e.ts) })).join("\n");
    const r = await fetch(`${host}/v0/events?name=vault_events&wait=true`, { method: "POST", headers: auth, body, signal: timeout() });
    const ingest = await r.text();
    if (!r.ok) throw new Error(`events HTTP ${r.status}: ${ingest.slice(0, 160)}`);
    if (process.env.TB_DEBUG) console.error("ingest:", ingest);
  }
  const q = await fetch(`${host}/v0/pipes/vault_evidence.json?session=${encodeURIComponent(session)}`, { headers: auth, signal: timeout() });
  if (!q.ok) throw new Error(`pipe HTTP ${q.status}: ${(await q.text()).slice(0, 160)}`);
  const row = (await q.json()).data?.[0] ?? {};
  const n = (k: keyof Counts) => Number(row[k] ?? 0);
  return { pinned: n("pinned"), drifted_flagged: n("drifted_flagged"), shipped_contradictions: n("shipped_contradictions"),
    clean_shipped: n("clean_shipped"), false_refusals: n("false_refusals"), unforced_refusals: n("unforced_refusals"),
    gate_p95_ms: n("gate_p95_ms") };
}

export interface Volatility { url: string; field: string; checks: number; drifts: number; rate: number; runs: number }

// T2 — which pinned facts move most, across every live run ever streamed (history local files lose on reset).
export async function volatility(adapter = "nimble-mcp"): Promise<Volatility[]> {
  const host = process.env.TINYBIRD_HOST, token = process.env.TINYBIRD_TOKEN;
  if (!host || !token) throw new Error("TINYBIRD_HOST / TINYBIRD_TOKEN not set");
  const q = await fetch(`${host}/v0/pipes/vault_volatility.json?adapter=${encodeURIComponent(adapter)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!q.ok) throw new Error(`pipe HTTP ${q.status}`);
  return ((await q.json()).data ?? []).map((r: Record<string, unknown>) => ({
    url: String(r.url), field: String(r.field), checks: Number(r.checks), drifts: Number(r.drifts), rate: Number(r.rate), runs: Number(r.runs) }));
}
