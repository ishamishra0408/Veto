// T3 — stream veto events to Tinybird as they happen. Never blocks a verdict: fire-and-forget with a bounded
// wait, errors swallowed. evidence.ts re-syncs everything idempotently, so a dropped event is repaired later.
import { chTime, type VetoEvent } from "./tinybird.ts";

const pending: Promise<unknown>[] = [];
let sent = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function eventsFor(session: string, pins: { pin_id: string; fetched_at: string }[], receipts: any[], runs: any[]): VetoEvent[] {
  const base = { session, n_drifted: 0, verdict: "", mode: "", shipped: 0, rebased: 0, adapter: "", gate_ms: 0, url: "", field: "", drifted: 0 };
  return [
    ...pins.map((p) => ({ ...base, kind: "pin" as const, event_id: p.pin_id, ts: p.fetched_at })),
    ...receipts.map((r) => ({ ...base, kind: "receipt" as const, event_id: `${r.refused_at}|${r.reason}`, ts: r.refused_at, n_drifted: r.drifted_facts.length })),
    ...runs.flatMap((r) => [
      { ...base, kind: "run" as const, event_id: `${r.run_at}|${r.mode}`, ts: r.run_at, verdict: r.verdict, mode: r.mode,
        shipped: r.shipped ? 1 : 0, rebased: r.rebased ? 1 : 0, adapter: r.adapter ?? "", gate_ms: r.gate_ms ?? 0,
        drifted: r.contradiction ? 1 : 0 }, // for kind=run, `drifted` = shipped contradiction
      ...(r.checks ?? []).map((c: { url: string; field: string; drifted: number }) => (
        { ...base, kind: "check" as const, event_id: `${r.run_at}|${c.url}|${c.field}`, ts: r.run_at, mode: r.mode,
          adapter: r.adapter ?? "", url: c.url, field: c.field, drifted: c.drifted })),
    ]),
  ];
}

export function emit(events: VetoEvent[]) {
  const host = process.env.TINYBIRD_HOST, token = process.env.TINYBIRD_TOKEN;
  if (!host || !token || !events.length || process.env.VETO_STREAM === "off") return;
  const body = events.map((e) => JSON.stringify({ ...e, ts: chTime(e.ts) })).join("\n");
  pending.push(fetch(`${host}/v0/events?name=vault_events`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body, signal: AbortSignal.timeout(4000),
  }).then((r) => { if (r.ok) sent += events.length; }).catch(() => {}));
}

export async function flush() {
  await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, 4000))]);
  if (sent) process.stderr.write(`\x1b[32m[tinybird]\x1b[0m streamed ${sent} events\n`);
  pending.length = 0; sent = 0;
}
