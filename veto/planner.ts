// The multi-step plan: plan → act → observe → reason → self-correct, persisted to plan.json for the console.
// The plan is a dependency graph: every conclusion lists the pins it rests on, so a drift invalidates exactly
// the conclusions that cite a changed pin — and nothing else has to be redone.
import { writeFileSync } from "node:fs";
import type { Drift } from "./gate.ts";
import type { Conclusion } from "./report.ts";

export const PLAN = new URL("./plan.json", import.meta.url);
const ansi = (c: string) => (process.stdout.isTTY ? `\x1b[${c}m` : "");

export type Kind = "plan" | "act" | "observe" | "reason" | "correct";
export interface Step { id: string; kind: Kind; title: string; status: "pending" | "done" | "replanned" | "failed" | "skipped"; detail?: string; at?: string }

export class Plan {
  goal: string;
  steps: Step[];
  impact: { affected: { id: string; label: string }[]; unaffected: number; drifted_pins: string[] } | null = null;
  recommendation: { before: number | null; after: number | null } = { before: null, after: null };

  constructor(goal: string, steps: Omit<Step, "status">[]) {
    this.goal = goal;
    this.steps = steps.map((s) => ({ ...s, status: "pending" }));
    console.log(`${ansi("1;34")}[plan]${ansi("0")} goal: ${goal}`);
    this.save();
  }

  mark(id: string, status: Step["status"], detail: string) {
    const s = this.steps.find((x) => x.id === id)!;
    Object.assign(s, { status, detail, at: new Date().toISOString() });
    const icon = { done: "✓", replanned: "↻", failed: "✗", skipped: "–", pending: "·" }[status];
    console.log(`${ansi("1;34")}[plan ${s.id} ${s.kind}]${ansi("0")} ${icon} ${s.title}: ${detail}`);
    this.save();
  }

  save() { writeFileSync(PLAN, JSON.stringify(this, null, 2)); }
}

// Which conclusions does a drift break? Exactly those citing a drifted pin.
export function impactOf(conclusions: Conclusion[], drifted: Drift[]) {
  const hit = new Set(drifted.map((d) => d.pin_id));
  const affected = conclusions.filter((c) => c.pins.some((p) => hit.has(p)));
  return { affected: affected.map((c) => ({ id: c.id, label: c.label })), unaffected: conclusions.length - affected.length, drifted_pins: [...hit] };
}
