#!/usr/bin/env node
// Veto console — one HTML page generated from committed evidence. Every number on it is read from a file
// under evidence/ (or the run folder passed as --plan); nothing is typed in. The data is inlined so the
// page runs from file:// (the design gate) and from any static server (the demo, Pages).
//   node demo/console/build.mjs [--live <dir>] [--mock <dir>] [--plan <dir>] [--out demo/console/index.html]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const LIVE = arg('--live', path.join(ROOT, 'evidence/live-run-2026-09-25-trace'));
const MOCK = arg('--mock', path.join(ROOT, 'evidence/mock-run-2026-09-25'));
const PLAN = arg('--plan', null);
const OUT = arg('--out', path.join(ROOT, 'demo/console/index.html'));
const jsonl = (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const jload = (p) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
const lines = (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n') : [];
const data = {
  live: { pins: jload(`${LIVE}/pins.json`) || [], receipts: jsonl(`${LIVE}/receipts.jsonl`), runs: jsonl(`${LIVE}/runs.jsonl`), trace: jsonl(`${LIVE}/mcp-trace.jsonl`), evidence: lines(`${LIVE}/evidence.txt`), dir: path.relative(ROOT, LIVE) },
  mock: { receipts: jsonl(`${MOCK}/receipts.jsonl`), runs: jsonl(`${MOCK}/runs.jsonl`), ships: jsonl(`${MOCK}/ships.jsonl`), verify: lines(`${MOCK}/verify_pins.txt`), r5: lines(`${MOCK}/r5_report_sha256.txt`), dir: path.relative(ROOT, MOCK) },
  // A run folder outside the repo is labelled, never pathed: a machine path on a public console says nothing true to a judge.
  plan: PLAN ? { plan: jload(`${PLAN}/plan.json`) || jload(`${PLAN}/plan.night2.json`), ships: jsonl(`${PLAN}/ships.jsonl`), receipts: jsonl(`${PLAN}/receipts.jsonl`), runs: jsonl(`${PLAN}/runs.jsonl`), pins: jload(`${PLAN}/pins.json`) || [], dir: path.resolve(PLAN).startsWith(ROOT + path.sep) ? path.relative(ROOT, PLAN) : 'local run, not yet committed under evidence/' } : null,
  built_at: new Date().toISOString(),
};
const tpl = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'console.template.html'), 'utf8');
const html = tpl.replace('/*__DATA__*/', JSON.stringify(data).replace(/<\/script/g, '<\\/script'));
fs.writeFileSync(OUT, html);
console.log(`wrote ${path.relative(ROOT, OUT)} · live ${data.live.pins.length} pins, ${data.live.receipts.length} receipts, ${data.live.trace.length} trace rows · mock ${data.mock.receipts.length} receipts · plan ${data.plan ? 'yes' : 'no'}`);
