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
const first = (dir, names) => dir ? names.find((f) => fs.existsSync(`${dir}/${f}`)) || null : null;
// Citations resolved, counted over every verify_report*.txt in the run folder: one line per citation ("OK <pin>"),
// plus one "N/M resolved" summary line per file, which is a total and not a citation, so it is skipped.
const verifyCount = (dir) => {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^verify_report.*\.txt$/.test(f)).sort() : [];
  let ok = 0, total = 0;
  for (const f of files) for (const l of lines(`${dir}/${f}`)) { if (!l.trim() || /^\d+\/\d+ resolved\b/.test(l)) continue; total++; if (/^OK\b/.test(l)) ok++; }
  return { ok, total, files: files.length };
};
// The refused draft, as the terminal printed it: the lines after "The draft that would have shipped:" up to the next blank line.
const draftBlock = (p) => {
  const ls = lines(p), i = ls.findIndex((l) => l.startsWith('The draft that would have shipped:')), out = [];
  if (i > -1) for (let j = i + 1; j < ls.length && ls[j].trim(); j++) out.push(ls[j].trim());
  return out;
};
// What the shipped report actually discloses: each "[was-pin:<old>] ... [pin:<new>]" pair on one line of the re-based section.
const disclosed = (p) => p ? [...fs.readFileSync(p, 'utf8').matchAll(/\[was-pin:([0-9a-f]+)\][^[\n]*\[pin:([0-9a-f]+)\]/g)].map((m) => ({ was: m[1], pin: m[2] })) : [];
const planFile = first(PLAN, ['plan.json', 'plan.night2.json']), shippedFile = first(PLAN, ['report.shipped.md', 'report.night2.shipped.md']);
const data = {
  live: { pins: jload(`${LIVE}/pins.json`) || [], receipts: jsonl(`${LIVE}/receipts.jsonl`), runs: jsonl(`${LIVE}/runs.jsonl`), ships: jsonl(`${LIVE}/ships.jsonl`), trace: jsonl(`${LIVE}/mcp-trace.jsonl`), evidence: lines(`${LIVE}/evidence.txt`), verify: verifyCount(LIVE), draft: draftBlock(`${LIVE}/demo-output.txt`), draft_file: 'demo-output.txt', dir: path.relative(ROOT, LIVE) },
  mock: { receipts: jsonl(`${MOCK}/receipts.jsonl`), runs: jsonl(`${MOCK}/runs.jsonl`), ships: jsonl(`${MOCK}/ships.jsonl`), verify: lines(`${MOCK}/verify_pins.txt`), r5: lines(`${MOCK}/r5_report_sha256.txt`), dir: path.relative(ROOT, MOCK) },
  // A run folder outside the repo is labelled, never pathed: a machine path on a public console says nothing true to a judge.
  plan: PLAN ? { plan: planFile ? jload(`${PLAN}/${planFile}`) : null, plan_file: planFile, ships: jsonl(`${PLAN}/ships.jsonl`), receipts: jsonl(`${PLAN}/receipts.jsonl`), runs: jsonl(`${PLAN}/runs.jsonl`), pins: jload(`${PLAN}/pins.json`) || [], disclosed: disclosed(shippedFile && `${PLAN}/${shippedFile}`), shipped_file: shippedFile, dir: path.resolve(PLAN).startsWith(ROOT + path.sep) ? path.relative(ROOT, PLAN) : 'local run, not yet committed under evidence/' } : null,
  built_at: new Date().toISOString(),
};
const tpl = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'console.template.html'), 'utf8');
const html = tpl.replace('/*__DATA__*/', JSON.stringify(data).replace(/<\/script/g, '<\\/script'));
fs.writeFileSync(OUT, html);
console.log(`wrote ${path.relative(ROOT, OUT)} · live ${data.live.pins.length} pins, ${data.live.receipts.length} receipts, ${data.live.ships.length} ships, ${data.live.trace.length} trace rows, ${data.live.verify.ok}/${data.live.verify.total} citations resolved over ${data.live.verify.files} verify file(s), ${data.live.draft.length} draft line(s) · mock ${data.mock.receipts.length} receipts · plan ${data.plan ? `${data.plan.plan_file || 'none'}, ${data.plan.disclosed.length} disclosed pair(s)` : 'no'}`);
