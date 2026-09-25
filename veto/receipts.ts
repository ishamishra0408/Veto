// Append-only refusal log. One JSON line per refusal.
import { appendFileSync } from "node:fs";
import type { Verdict } from "./gate.ts";

export const RECEIPTS = new URL("./receipts.jsonl", import.meta.url);

export function appendReceipt(v: Exclude<Verdict, { status: "CLEAN" }>, explanation: string[] = [], confirm: unknown[] = []) {
  const receipt = {
    refused_at: new Date().toISOString(),
    reason: v.status,
    drifted_facts: v.status === "DRIFTED" ? v.drifted : [],
    error: v.status === "UNREACHABLE" ? v.error : null,
    pin_hashes: v.pin_hashes,
    basis_window: v.basis_window,
    ...(explanation.length ? { explanation } : {}),
    ...(confirm.length ? { confirm } : {}),
  };
  appendFileSync(RECEIPTS, JSON.stringify(receipt) + "\n");
  return receipt;
}

// G4: every CLEAN ship leaves a receipt too — what shipped, on which basis.
export const SHIPS = new URL("./ships.jsonl", import.meta.url);

export function appendShip(v: Extract<Verdict, { status: "CLEAN" }>, rebased = false) {
  const ship = { shipped_at: new Date().toISOString(), reason: "CLEAN", rebased, pin_hashes: v.pin_hashes, basis_window: v.basis_window };
  appendFileSync(SHIPS, JSON.stringify(ship) + "\n");
  return ship;
}
