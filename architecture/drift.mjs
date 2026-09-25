#!/usr/bin/env node
/* drift — refuse a push where the architecture model and the code disagree.
 *
 *   node architecture/drift.mjs            report, exit 1 on any finding
 *   node architecture/drift.mjs --negative plant each fault and prove it is caught
 *
 * The model cannot be generated from the code: edge labels, the traces and the decisions are intent,
 * and code has none. What CAN be checked is that the two describe the same parts, wired the same way:
 *
 *   unclaimed   a source file under server/ or web/src/ that no component's "code" property names
 *   missing     a component whose "code" names a file that no longer exists
 *   unwired     a value import between files owned by two different components, with no line
 *               between those components in workspace.dsl (either direction counts as drawn)
 *
 * Extra lines are allowed: a model may draw a dependency the imports do not show (a type import the
 * reader relies on, a runtime call through fetch). Missing lines are not.
 *
 * exit 0 in sync · 1 drift found · 3 UNEVALUABLE (the model could not be read) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* CONFIGURE PER REPO — these three lines are the only ones that name this project.
   MODEL: the one workspace under architecture/. SOURCES: the folders whose files are parts.
   SHARED: files nearly every module imports (types, formatters); a line from every module to them
   would say nothing, so they are named here, in the one place a reader looks, not exempted silently. */
const MODEL = 'veto';                                       // architecture/veto/workspace.dsl
const SOURCES = ['veto'];                                   // one CLI folder; its node_modules is ignored below
export const SHARED = new Set([]);

const DSL = path.join(ROOT, 'architecture', MODEL, 'workspace.dsl');
// veto/node_modules is a dependency tree, not a part of this model.
const IGNORED = (f) => /\.test\.[jt]sx?$/.test(f) || /\.spec\.[jt]sx?$/.test(f) || /\.d\.ts$/.test(f) || /(^|\/)node_modules\//.test(f);

/** Components with their files, and every relationship as an unordered pair of identifiers. */
export function readModel(text) {
  const components = new Map(); // id -> [files]
  const re = /(\w+)\s*=\s*component\s+"[^"]*"[^{\n]*\{([\s\S]*?)\n\s{16}\}/g;
  for (const m of text.matchAll(re)) {
    const code = m[2].match(/"code"\s+"([^"]+)"/);
    components.set(m[1], code ? code[1].split(',').map((s) => s.trim()) : []);
  }
  const edges = new Set();
  const model = text.slice(text.indexOf('model {'), text.indexOf('views {'));
  for (const m of model.matchAll(/^\s*(\w+)\s*->\s*(\w+)\s+"/gm)) edges.add([m[1], m[2]].sort().join('|'));
  return { components, edges };
}

/** Value imports only: `import type` and inline-only `type` specifiers carry no runtime dependency. */
export function importsOf(src) {
  const out = [];
  for (const m of src.matchAll(/^import\s+(type\s+)?([\s\S]*?)\s+from\s+['"](\.[^'"]+)['"]/gm)) {
    if (m[1]) continue;
    const specs = m[2].replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    if (specs.length && specs.every((s) => s.startsWith('type '))) continue;
    out.push(m[3]);
  }
  for (const m of src.matchAll(/^import\s+'(\.[^']+)'/gm)) out.push(m[1]);
  return out;
}

function resolve(fromFile, spec, exists) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec)).replace(/\.js$/, '');
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js', '']) if (exists(base + ext)) return base + ext;
  return null;
}

export function check({ text, files, read, exists }) {
  const { components, edges } = readModel(text);
  if (!components.size) return { state: 'UNEVALUABLE', why: 'no components were read from workspace.dsl', findings: [] };
  const owner = new Map();
  for (const [id, fs_] of components) for (const f of fs_) owner.set(f, id);
  const findings = [];
  for (const [id, fs_] of components) {
    for (const f of fs_) if (!exists(f)) findings.push({ rule: 'missing', where: id, why: `"code" names ${f}, which does not exist` });
  }
  const parts = files.filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !IGNORED(f) && !SHARED.has(f));
  for (const f of parts) {
    if (!owner.has(f)) { findings.push({ rule: 'unclaimed', where: f, why: 'no component names this file in its "code" property' }); continue; }
    for (const spec of importsOf(read(f))) {
      if (/\.css$/.test(spec)) continue;
      const to = resolve(f, spec, exists);
      if (!to || SHARED.has(to) || IGNORED(to)) continue;
      const a = owner.get(f), b = owner.get(to);
      if (!b || a === b) continue;
      if (!edges.has([a, b].sort().join('|'))) {
        findings.push({ rule: 'unwired', where: `${a} -> ${b}`, why: `${f} imports ${to}, and the model draws no line between ${a} and ${b}` });
      }
    }
  }
  return { state: findings.length ? 'DRIFT' : 'in sync', findings, components: components.size, files: parts.length };
}

function walk(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.posix.join(dir, e.name)) : [path.posix.join(dir, e.name)]);
}

// Compare REAL paths: on macOS /tmp is a symlink to /private/tmp, and a plain compare made the script
// skip its whole main block and exit 0 silently (measured 2026-09-23) — a pass that checked nothing.
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const IS_MAIN = process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url));
if (IS_MAIN) {
  if (process.argv.includes('--negative')) {
    const model = `model {
        s = container "S" {
                a = component "A" "" "" {
                    properties {
                        "code" "server/a.ts"
                    }
                }
                b = component "B" "" "" {
                    properties {
                        "code" "server/b.ts,server/gone.ts"
                    }
                }
        }
    }
    views {`;
    const disk = { 'server/a.ts': "import { x } from './b.js';\nimport type { T } from './c.js';\n", 'server/b.ts': '', 'server/c.ts': '' };
    const r = check({ text: model, files: Object.keys(disk), read: (f) => disk[f], exists: (f) => f in disk });
    const rules = r.findings.map((f) => f.rule).sort();
    const want = ['missing', 'unclaimed', 'unwired'];
    const ok = JSON.stringify(rules) === JSON.stringify(want);
    const wired = check({ text: model.replace('views {', '').replace('    }\n    ', '        a -> b "uses"\n    }\n    views {'), files: Object.keys(disk), read: (f) => disk[f], exists: (f) => f in disk });
    const ok2 = !wired.findings.some((f) => f.rule === 'unwired');
    console.log(`  ${ok ? 'caught' : 'MISSED'}  missing, unclaimed and unwired are each reported once (got ${rules.join(', ')})`);
    console.log(`  ${ok2 ? 'caught' : 'MISSED'}  a drawn line clears the unwired finding, and a type import raises none`);
    process.exit(ok && ok2 ? 0 : 1);
  }
  if (MODEL === 'CHANGE-ME') { console.log('UNEVALUABLE  set MODEL, SOURCES and SHARED at the top of architecture/drift.mjs'); process.exit(3); }
  let text;
  try { text = fs.readFileSync(DSL, 'utf8'); } catch (e) { console.log(`UNEVALUABLE  ${e.message}`); process.exit(3); }
  const files = SOURCES.flatMap(walk);
  const r = check({ text, files, read: (f) => fs.readFileSync(path.join(ROOT, f), 'utf8'), exists: (f) => fs.existsSync(path.join(ROOT, f)) });
  if (r.state === 'UNEVALUABLE') { console.log(`UNEVALUABLE  ${r.why}`); process.exit(3); }
  console.log(`  drift · ${r.components} components · ${r.files} source files · shared: ${[...SHARED].join(', ')}`);
  for (const f of r.findings) console.log(`    ${f.rule.padEnd(10)} ${f.where}\n               ${f.why}`);
  console.log(`  ${r.state}${r.findings.length ? ` — ${r.findings.length} finding(s): edit architecture/shipgate/workspace.dsl in the same change` : ''}`);
  process.exit(r.findings.length ? 1 : 0);
}
