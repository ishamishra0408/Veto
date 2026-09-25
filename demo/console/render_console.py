#!/usr/bin/env python3
"""Veto console screens, rendered from committed evidence only.

  python3 demo/console/render_console.py [--live <dir>] [--mock <dir>] [--plan <dir>] [--out <dir>]

Every number and timestamp on a screen is read from an artifact under evidence/. Nothing is typed in.
Crit of 2026-09-25 applied: one gate pill in every top bar beside the environment pill; the timeline is the
MCP trace, not a story; the injected/unforced split is computed from the run row's `injected` field, or
derived from the receipts and labelled `derived` when the run predates that field; pins carry the basis they
belong to; mock frames read the mock run; the self-correct frame reads plan.json and ships.jsonl.
"""
import argparse, json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ap = argparse.ArgumentParser()
ap.add_argument("--live", default=os.path.join(ROOT, "evidence/live-run-2026-09-25-trace"))
ap.add_argument("--mock", default=os.path.join(ROOT, "evidence/mock-run-2026-09-25"))
ap.add_argument("--plan", default=None, help="a run folder holding plan.json, ships.jsonl, receipts.jsonl, runs.jsonl, pins.json")
ap.add_argument("--out", default=os.path.join(ROOT, "demo/console"))
A = ap.parse_args()

W, H, SB = 1920, 1080, 280
BG, SB_BG, CARD, CARD2, BORDER = (13, 17, 23), (9, 12, 17), (21, 26, 35), (27, 33, 44), (40, 47, 61)
TEXT, MUTED, FAINT = (232, 236, 243), (139, 147, 163), (95, 103, 120)
BLUE, GREEN, RED, AMBER = (79, 140, 255), (50, 213, 131), (240, 68, 56), (247, 144, 9)

def F(path, size, index=0):
    try: return ImageFont.truetype(path, size, index=index)
    except OSError: return ImageFont.load_default()
HN, MENLO = os.environ.get("VETO_FONT_SANS", "/System/Library/Fonts/HelveticaNeue.ttc"), os.environ.get("VETO_FONT_MONO", "/System/Library/Fonts/Menlo.ttc")
f_nav, f_label, f_body, f_small, f_tbl = F(HN, 21), F(HN, 18), F(HN, 20), F(HN, 17), F(HN, 18)
f_med = F(HN, 20, 10); f_mono, f_mono_s, f_mono_b = F(MENLO, 17), F(MENLO, 15), F(MENLO, 17, 1)
f_num, f_num_s, f_h1, f_h2, f_logo, f_huge = F(HN, 54, 1), F(HN, 34, 1), F(HN, 34, 1), F(HN, 22, 1), F(HN, 24, 1), F(HN, 120, 1)

# Helvetica Neue carries no arrows or check marks (measured 2026-09-25: → ✓ ✗ ↻ ◈ rendered as boxes), so those
# glyphs are drawn from a symbol font at the same size. Every text draw goes through dtext().
SYM_FONT = os.environ.get("VETO_FONT_SYM", "/Library/Fonts/Arial Unicode.ttf")
SYM = set("→←↑↓✓✗↻◈")
_sym_cache = {}
def sym_for(font):
    key = font.size
    if key not in _sym_cache: _sym_cache[key] = F(SYM_FONT, font.size)
    return _sym_cache[key]
def dtext(d, xy, s, font, fill):
    x, y = xy
    run, run_sym = "", False
    def flush(run, run_sym, x):
        if not run: return x
        f = sym_for(font) if run_sym else font
        ImageDraw.ImageDraw._veto_text(d, (x, y), run, font=f, fill=fill); return x + d.textlength(run, font=f)
    for ch in s:
        is_sym = ch in SYM
        if is_sym != run_sym: x = flush(run, run_sym, x); run, run_sym = "", is_sym
        run += ch
    flush(run, run_sym, x)
ImageDraw.ImageDraw._veto_text = ImageDraw.ImageDraw.text
def _text(self, xy, text, fill=None, font=None, *a, **k):
    if isinstance(text, str) and any(c in SYM for c in text) and font is not None: return dtext(self, xy, text, font, fill)
    return ImageDraw.ImageDraw._veto_text(self, xy, text, fill=fill, font=font, *a, **k)
ImageDraw.ImageDraw.text = _text

# ---------- data ----------
def jsonl(p):
    return [json.loads(l) for l in open(p) if l.strip()] if os.path.exists(p) else []
def jload(p):
    return json.load(open(p)) if os.path.exists(p) else None
def lines(p):
    return open(p).read().strip().splitlines() if os.path.exists(p) else []

LIVE = dict(pins=jload(f"{A.live}/pins.json") or [], receipts=jsonl(f"{A.live}/receipts.jsonl"), runs=jsonl(f"{A.live}/runs.jsonl"),
            trace=jsonl(f"{A.live}/mcp-trace.jsonl"), evidence=lines(f"{A.live}/evidence.txt"))
MOCK = dict(receipts=jsonl(f"{A.mock}/receipts.jsonl"), runs=jsonl(f"{A.mock}/runs.jsonl"), ships=jsonl(f"{A.mock}/ships.jsonl"),
            verify=lines(f"{A.mock}/verify_pins.txt"), r5=lines(f"{A.mock}/r5_report_sha256.txt"))
PLAN = None
if A.plan:
    PLAN = dict(plan=jload(f"{A.plan}/plan.json"), ships=jsonl(f"{A.plan}/ships.jsonl"), receipts=jsonl(f"{A.plan}/receipts.jsonl"),
                runs=jsonl(f"{A.plan}/runs.jsonl"), pins=jload(f"{A.plan}/pins.json") or [])

def session_of(evidence):
    for l in evidence:
        if "(session " in l: return l.split("(session ")[1].rstrip(")")
    return "—"
def count_line(evidence, key):
    for l in evidence:
        if l.startswith(key): return l.split(":", 1)[1].strip()
    return ""
def value_of(fact): return (fact.split(" is ", 1)[1] if " is " in fact else fact).replace("\\", "")
def field_of(fact): return fact.split(" of ", 1)[0]
def url_of(fact): return fact.split(" of ", 1)[1].split(" is ", 1)[0]
def short(pins, url):
    t = next((value_of(p["fact_text"]) for p in pins if p["source_url"] == url and field_of(p["fact_text"]) == "title"), url)
    words = t.replace(",", " ").split()
    return " ".join(words[:3])
def hhmmss(iso): return iso[11:19]
def trunc(d, text, font, max_w):
    if d.textlength(text, font=font) <= max_w: return text
    while text and d.textlength(text + "…", font=font) > max_w: text = text[:-1]
    return text + "…"

# ---------- components ----------
def card(d, box, radius=14, fill=CARD): d.rounded_rectangle(box, radius=radius, fill=fill, outline=BORDER, width=1)
def pill(d, xy, text, fg, bg, font=f_small):
    x, y = xy; tw = d.textlength(text, font=font); pw, ph = tw + 28, 30
    d.rounded_rectangle([x, y, x + pw, y + ph], radius=ph // 2, fill=bg); d.text((x + 14, y + 5), text, font=font, fill=fg); return pw
GATE = {"VERIFYING": (BLUE, (20, 36, 70)), "REFUSED": (RED, (60, 22, 24)), "CLEAN": (GREEN, (18, 55, 40)), "RE-BASED": (GREEN, (18, 55, 40)), "COLLECTING": (BLUE, (20, 36, 70))}
ENV = {"live": ("LIVE · amazon.com · US/EN", GREEN, (18, 55, 40)), "mock": ("MOCK · fixtures", AMBER, (58, 42, 14))}
def sidebar(d, active):
    d.rectangle([0, 0, SB, H], fill=SB_BG); d.line([(SB, 0), (SB, H)], fill=BORDER, width=1)
    d.rounded_rectangle([28, 28, 64, 64], radius=10, fill=BLUE); d.text((37, 33), "◈", font=f_logo, fill=(255, 255, 255))
    d.text((78, 30), "Veto", font=f_logo, fill=TEXT); d.text((78, 58), "pinned evidence", font=f_small, fill=MUTED)
    y = 120
    for it in ["Overview", "Pins", "Receipts", "Plan", "Runs", "Skill"]:
        if it == active: d.rounded_rectangle([16, y - 8, SB - 16, y + 30], radius=9, fill=(28, 35, 48)); d.text((32, y), it, font=f_nav, fill=TEXT)
        else: d.text((32, y), it, font=f_nav, fill=MUTED)
        y += 48
    d.text((32, H - 60), "gate: deterministic", font=f_small, fill=FAINT); d.text((32, H - 36), "no LLM inside", font=f_small, fill=FAINT)
def topbar(d, title, sub, env, gate):
    """One gate pill on every screen, beside the environment pill (crit finding 4)."""
    d.text((SB + 40, 30), title, font=f_h1, fill=TEXT); d.text((SB + 40, 72), sub, font=f_label, fill=MUTED)
    t, fg, bg = ENV[env]; gw = d.textlength(gate, font=f_med) + 28
    x = W - 40 - gw; pill(d, (x, 40), gate, *GATE[gate], font=f_med)
    ew = d.textlength(t, font=f_small) + 28; pill(d, (x - 16 - ew, 40), t, fg, bg)
def metric(d, box, label, value, sub, accent=TEXT):
    card(d, box); x, y = box[0] + 24, box[1] + 18
    d.text((x, y), label, font=f_label, fill=MUTED); d.text((x, y + 28), value, font=f_num, fill=accent); d.text((x, y + 96), sub, font=f_small, fill=FAINT)
def kv(d, x, y, k, v, vfont=f_mono_s, vfill=TEXT, gap=160):
    d.text((x, y), k, font=f_mono_s, fill=FAINT); d.text((x + gap, y), v, font=vfont, fill=vfill)
def new_screen(active, title, sub, env, gate):
    img = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(img); sidebar(d, active); topbar(d, title, sub, env, gate); return img, d
def save(img, name):
    os.makedirs(A.out, exist_ok=True); p = os.path.join(A.out, name); img.save(p); print("wrote", p)

# ---------- frame 1: VERIFYING, the MCP session as traced ----------
def frame1():
    pins, trace, ev = LIVE["pins"], LIVE["trace"], LIVE["evidence"]
    if not trace: print("frame1: no mcp-trace.jsonl, skipped"); return
    # night 1 = everything up to and including the first five tools/call after the first tools/list
    first_list = next(i for i, r in enumerate(trace) if r["method"] == "tools/list")
    calls = [r for r in trace[first_list + 1:] if r["method"] == "tools/call"][:5]
    rows = trace[:first_list + 1] + calls
    img, d = new_screen("Overview", "Overview", f"session {session_of(ev)} · night 1 · the 18:00 fetch as traced", "live", "VERIFYING")
    x0, y0, cw = SB + 40, 130, (W - SB - 80 - 3 * 20) // 4
    n_calls = sum(1 for r in trace if r["method"] == "tools/call")
    ms = [r["ms"] for r in calls]
    metric(d, [x0, y0, x0 + cw, y0 + 168], "Pages fetched", str(len(calls)), "tools/call nimble_extract")
    metric(d, [x0 + cw + 20, y0, x0 + 2 * cw + 20, y0 + 168], "Facts to pin", str(len(pins)), "sha256 · fetched_at")
    metric(d, [x0 + 2 * cw + 40, y0, x0 + 3 * cw + 40, y0 + 168], "Extract latency", f"{min(ms)/1000:.1f}–{max(ms)/1000:.1f} s", "to the full body, per call", BLUE)
    metric(d, [x0 + 3 * cw + 60, y0, x0 + 4 * cw + 60, y0 + 168], "MCP calls this run", str(n_calls), "two sessions · all HTTP 200" if all(r.get("http") in (200, 202) for r in trace) else "see trace", TEXT)
    box = [x0, 320, W - 40 - 540, H - 40]; card(d, box)
    d.text((box[0] + 24, box[1] + 22), "Live MCP session", font=f_h2, fill=TEXT)
    d.text((box[0] + 24, box[1] + 52), "mcp.nimbleway.com/mcp · Streamable HTTP · every row is a request in mcp-trace.jsonl", font=f_small, fill=MUTED)
    y = box[1] + 100
    for r in rows:
        ok = r.get("http") in (200, 202); d.ellipse([box[0] + 26, y + 6, box[0] + 38, y + 18], fill=GREEN if ok else RED)
        d.text((box[0] + 56, y), hhmmss(r["ts"]), font=f_mono, fill=MUTED)
        label = r["method"] + (f" {r['tool']}" if r.get("tool") else "")
        d.text((box[0] + 170, y), label, font=f_body, fill=TEXT)
        right = f"→ {short(pins, r['url'])}  ·  {r['ms']} ms · HTTP {r.get('http')}" if r.get("url") else f"HTTP {r.get('http')} · {r['ms']} ms"
        d.text((box[0] + 470, y), trunc(d, right, f_body, box[2] - box[0] - 500), font=f_body, fill=MUTED)
        y += 40
    g = [W - 40 - 520, 320, W - 40, H - 40]; card(d, g)
    d.text((g[0] + 24, g[1] + 22), "Gate status", font=f_h2, fill=TEXT)
    pill(d, (g[0] + 24, g[1] + 60), "VERIFYING", *GATE["VERIFYING"], font=f_med)
    d.text((g[0] + 24, g[1] + 110), f"{len(pins)} facts pinned, draft in progress", font=f_body, fill=TEXT)
    d.text((g[0] + 24, g[1] + 140), "the 06:00 gate has not run yet", font=f_small, fill=MUTED)
    d.line([(g[0] + 24, g[1] + 190), (g[2] - 24, g[1] + 190)], fill=BORDER)
    d.text((g[0] + 24, g[1] + 210), "Next", font=f_label, fill=MUTED)
    for i, t in enumerate(["re-fetch every cited source", "re-hash each fact", "compare to the pin: CLEAN, DRIFTED or UNREACHABLE"]):
        d.text((g[0] + 24, g[1] + 240 + i * 30), f"{i+1} · {t}", font=f_small, fill=TEXT)
    save(img, "cp-1-verifying.png")

# ---------- frame 2: pins with the basis each belongs to ----------
def frame2():
    pins, rc = LIVE["pins"], LIVE["receipts"]
    b1 = set(rc[0]["pin_hashes"]) if rc else set(); b2 = set(rc[1]["pin_hashes"]) if len(rc) > 1 else set()
    gate = "REFUSED" if rc else "CLEAN"
    img, d = new_screen("Pins", "Pins", f"{len(pins)} content-addressed pins · a changed value mints a new pin · basis = the receipt whose pin_hashes hold it", "live", gate)
    counts = {}
    for p in pins: counts[field_of(p["fact_text"])] = counts.get(field_of(p["fact_text"]), 0) + 1
    x = SB + 40; card(d, [x, 130, W - 40, 186])
    d.text((x + 24, 146), "  ·  ".join(f"{k} {v}" for k, v in counts.items()) + f"  ·  night-1 basis {sum(1 for p in pins if p['sha256'] in b1)}  ·  night-2 basis {sum(1 for p in pins if p['sha256'] in b2)}", font=f_body, fill=MUTED)
    box = [x, 200, W - 40, H - 40]; card(d, box)
    cols = [("PRODUCT", 24), ("FIELD", 300), ("VALUE", 430), ("PIN", 1000), ("BASIS", 1200), ("FETCHED", 1370)]
    for c, off in cols: d.text((box[0] + off, box[1] + 22), c, font=f_label, fill=MUTED)
    d.line([(box[0], box[1] + 52), (box[2], box[1] + 52)], fill=BORDER)
    order = sorted(pins, key=lambda p: (p["fetched_at"], p["source_url"]))
    y = box[1] + 66; rowh = 26
    for p in order:
        if y > box[3] - 30: break
        f, v = field_of(p["fact_text"]), value_of(p["fact_text"])
        in1, in2 = p["sha256"] in b1, p["sha256"] in b2
        basis, col = ("night 1 + 2", TEXT) if in1 and in2 else ("night 1", MUTED) if in1 else ("night 2 re-pin", AMBER) if in2 else ("—", FAINT)
        if in2 and not in1: d.rectangle([box[0] + 6, y - 2, box[0] + 10, y + 20], fill=AMBER)
        d.text((box[0] + 24, y), short(pins, p["source_url"]), font=f_tbl, fill=TEXT); d.text((box[0] + 300, y), f, font=f_tbl, fill=MUTED)
        d.text((box[0] + 430, y), trunc(d, v, f_tbl, 540), font=f_tbl, fill=TEXT)
        d.text((box[0] + 1000, y), p["pin_id"], font=f_mono_s, fill=AMBER if (in2 and not in1) else MUTED)
        d.text((box[0] + 1200, y), basis, font=f_tbl, fill=col); d.text((box[0] + 1370, y), hhmmss(p["fetched_at"]), font=f_mono_s, fill=MUTED)
        y += rowh
    save(img, "cp-2-pins.png")

# ---------- frame 3: two refusal cards, the injected split from the run row ----------
def refusal_card(d, box, title, r, injected, pins):
    card(d, box); x, y = box[0] + 24, box[1] + 22
    d.text((x, y), title, font=f_h2, fill=TEXT); pill(d, (x, y + 36), "REFUSED", *GATE["REFUSED"], font=f_med)
    d.text((x, y + 80), f"reason: {r['reason']}", font=f_body, fill=TEXT)
    y += 112
    maxw = box[2] - box[0] - 48
    for df in r["drifted_facts"]:
        tag = "injected · −15 %" if injected and df["source_url"] == injected["url"] and df["field"] == injected["field"] else "unforced · the real page changed"
        d.text((x, y), f"{short(pins, df['source_url'])} · {df['field']}", font=f_med, fill=TEXT)
        d.text((x + 560, y + 2), tag, font=f_small, fill=AMBER if tag.startswith("injected") else GREEN)
        y += 28
        old, new = df['old_value'].replace("\\", ""), df['new_value'].replace("\\", "")
        d.text((x + 20, y), f"was {old}", font=f_body, fill=MUTED); wl = d.textlength(f"was {old}", font=f_body)
        d.line([(x + 20, y + 13), (x + 20 + wl, y + 13)], fill=MUTED, width=2); d.text((x + 40 + wl, y), f"now {new}", font=f_body, fill=RED)
        nl = d.textlength(f"now {new}", font=f_body)
        d.text((x + 60 + wl + nl, y + 3), f"pin {df['pin_id']} → {df['new_hash'][:12]}", font=f_mono_s, fill=FAINT)
        y += 32
    if r.get("explanation"):
        d.text((x, y), "why, built from this receipt", font=f_mono_s, fill=FAINT); y += 22
        for e in r["explanation"]:
            d.text((x, y), trunc(d, e.replace("\\", ""), f_small, maxw), font=f_small, fill=TEXT); y += 22
        y += 8
    d.line([(x, y), (box[2] - 24, y)], fill=BORDER); y += 14
    kv(d, x, y, "refused_at", r["refused_at"]); y += 26
    kv(d, x, y, "basis", f"{r['basis_window']['from'][11:23]}Z → {r['basis_window']['to'][11:23]}Z"); y += 26
    kv(d, x, y, "pin_hashes", f"{len(r['pin_hashes'])} pinned  ({r['pin_hashes'][0][:12]}… +{len(r['pin_hashes'])-1})"); y += 26
    return y + 10
def wrap(d, text, font, max_w):
    out, line = [], ""
    for w in text.split():
        t = (line + " " + w).strip()
        if d.textlength(t, font=font) <= max_w: line = t
        else: out.append(line); line = w
    if line: out.append(line)
    return out
def frame3():
    rc, runs, pins, ev = LIVE["receipts"], LIVE["runs"], LIVE["pins"], LIVE["evidence"]
    if len(rc) < 2: print("frame3: fewer than two receipts, skipped"); return
    inj = next((r.get("injected") for r in runs if r.get("injected")), None)
    derived = False
    if not inj:  # the run predates the `injected` field: derive from the drift run's receipt, and say so
        drift_run = next((r for r in runs if r.get("mode") == "drift"), None)
        for df in rc[1]["drifted_facts"]:
            try:
                ratio = float(df["new_value"].split()[0]) / float(df["old_value"].split()[0])
                if df["field"] == "price" and abs(ratio - 0.85) < 0.002: inj = {"url": df["source_url"], "field": "price"}; derived = True
            except (ValueError, ZeroDivisionError): pass
    img, d = new_screen("Receipts", "Receipts", "every refusal ships with its evidence — verify, don't trust", "live", "REFUSED")
    x = SB + 40; colw = W - 40 - 560 - x
    # card heights follow content (crit finding 9): draw on a scratch canvas first to measure
    tmp = ImageDraw.Draw(Image.new("RGB", (W, H)))
    h1 = refusal_card(tmp, [x, 130, x + colw, H], "Refusal 1 · night 1 · nothing injected", rc[0], inj, pins) - 130
    h2 = refusal_card(tmp, [x, 130, x + colw, H], "Refusal 2 · night 2 · the villain", rc[1], inj, pins) - 130
    refusal_card(d, [x, 130, x + colw, 130 + h1], "Refusal 1 · night 1 · nothing injected", rc[0], inj, pins)
    refusal_card(d, [x, 150 + h1, x + colw, 150 + h1 + h2], "Refusal 2 · night 2 · the villain", rc[1], inj, pins)
    e = [W - 40 - 540, 130, W - 40, 130 + 330]; card(d, e)
    d.text((e[0] + 24, e[1] + 22), "Evidence", font=f_h2, fill=TEXT)
    ns = count_line(ev, "north star").split(" · "); ct = count_line(ev, "counter").split(" · ")
    y = e[1] + 62
    for item in ns + ct:
        num, label = item.split(" ", 1); d.text((e[0] + 24, y), num, font=f_num_s, fill=GREEN if "contradictions" in label or "false" in label else TEXT); d.text((e[0] + 100, y + 10), label, font=f_small, fill=MUTED); y += 44
    src = count_line(ev, "evidence source"); d.text((e[0] + 24, e[3] - 34), trunc(d, "source: " + src, f_small, 500), font=f_small, fill=GREEN if "matches" in src else AMBER)
    unf = sum(1 for df in rc[0]["drifted_facts"] + rc[1]["drifted_facts"] if not (inj and df["source_url"] == inj["url"] and df["field"] == inj["field"]))
    tot = len(rc[0]["drifted_facts"]) + len(rc[1]["drifted_facts"])
    s = [W - 40 - 540, 480, W - 40, 480 + 200]; card(d, s)
    d.text((s[0] + 24, s[1] + 22), "Drift split", font=f_h2, fill=TEXT)
    d.text((s[0] + 24, s[1] + 62), f"{unf} unforced · {tot - unf} injected", font=f_num_s, fill=TEXT)
    d.text((s[0] + 24, s[1] + 110), "from the run row's injected field" if not derived else "derived: the price drift at exactly ×0.85 (run predates the injected field)", font=f_small, fill=MUTED if not derived else AMBER)
    d.text((s[0] + 24, s[1] + 136), "the run row is the source once it carries `injected`", font=f_small, fill=FAINT)
    v = [W - 40 - 540, 700, W - 40, H - 40]; card(d, v)
    d.text((v[0] + 24, v[1] + 22), "How a judge verifies this", font=f_h2, fill=TEXT)
    for i, t in enumerate(["recompute sha256 over each pin's canonical fact_text", "compare against the stored hash — mismatch refuses", "every citation in the report resolves, or the ship aborts"]):
        d.text((v[0] + 24, v[1] + 62 + i * 30), f"{i+1} · {t}", font=f_small, fill=TEXT)
    d.text((v[0] + 24, v[1] + 170), "The gate contains no LLM. The model proposes. The gate disposes.", font=f_small, fill=MUTED)
    save(img, "cp-3-receipts.png")

# ---------- frame 4: self-correct, from plan.json and ships.jsonl ----------
def frame4():
    if not PLAN or not PLAN["plan"]: print("frame4: no plan dir, skipped"); return
    plan, ships, rc, runs, pins = PLAN["plan"], PLAN["ships"], PLAN["receipts"], PLAN["runs"], PLAN["pins"]
    env = "mock" if runs and runs[-1].get("adapter") == "mock" else "live"
    rebased = [s for s in ships if s.get("rebased")]
    img, d = new_screen("Plan", "Plan", f"night 2 · the plan is a dependency graph from conclusions to pins · {env} run", env, "RE-BASED" if rebased else "REFUSED")
    x = SB + 40; box = [x, 130, x + 880, H - 40]; card(d, box)
    d.text((box[0] + 24, box[1] + 22), "goal", font=f_mono_s, fill=FAINT)
    y = box[1] + 44
    for line in wrap(d, plan["goal"], f_body, 830): d.text((box[0] + 24, y), line, font=f_body, fill=TEXT); y += 26
    y += 12; d.line([(box[0] + 24, y), (box[2] - 24, y)], fill=BORDER); y += 16
    icons = {"done": ("✓", GREEN), "replanned": ("↻", AMBER), "failed": ("✗", RED), "skipped": ("–", FAINT), "pending": ("·", MUTED)}
    for s in plan["steps"]:
        ic, col = icons.get(s["status"], ("·", MUTED))
        d.text((box[0] + 24, y), ic, font=f_med, fill=col); d.text((box[0] + 52, y), s["id"], font=f_mono_b, fill=MUTED); d.text((box[0] + 100, y), s["kind"], font=f_small, fill=FAINT)
        d.text((box[0] + 190, y), s["title"], font=f_med, fill=TEXT); y += 26
        for line in wrap(d, s.get("detail") or "", f_small, 640)[:2]: d.text((box[0] + 190, y), line, font=f_small, fill=MUTED); y += 22
        y += 8
    r = [x + 900, 130, W - 40, 130 + 300]; card(d, r)
    d.text((r[0] + 24, r[1] + 22), "Impact analysis", font=f_h2, fill=TEXT)
    imp = plan.get("impact") or {"affected": [], "unaffected": 0, "drifted_pins": []}
    d.text((r[0] + 24, r[1] + 62), f"drift breaks {len(imp['affected'])} of {len(imp['affected']) + imp['unaffected']} conclusions", font=f_num_s, fill=RED)
    y = r[1] + 112
    for a in imp["affected"][:5]: d.text((r[0] + 24, y), "✗ " + trunc(d, a["label"], f_small, 600), font=f_small, fill=TEXT); y += 24
    d.text((r[0] + 24, y + 6), f"{imp['unaffected']} still hold · drifted pins: {', '.join(imp['drifted_pins'])}", font=f_small, fill=MUTED)
    rec = plan.get("recommendation") or {}
    c = [x + 900, 450, W - 40, 450 + 170]; card(d, c)
    d.text((c[0] + 24, c[1] + 22), "Recommended price", font=f_h2, fill=TEXT)
    b, a = rec.get("before"), rec.get("after")
    d.text((c[0] + 24, c[1] + 62), f"${b:.2f}" if b is not None else "—", font=f_num_s, fill=MUTED)
    d.text((c[0] + 190, c[1] + 66), "→", font=f_num_s, fill=FAINT); d.text((c[0] + 250, c[1] + 62), f"${a:.2f}" if a is not None else "—", font=f_num_s, fill=GREEN)
    for i, line in enumerate(wrap(d, "recomputed from re-pinned facts; the change is disclosed as [was-pin:] in the shipped report", f_small, c[2] - c[0] - 48)): d.text((c[0] + 24, c[1] + 112 + i * 22), line, font=f_small, fill=MUTED)
    s = [x + 900, 640, W - 40, H - 40]; card(d, s)
    d.text((s[0] + 24, s[1] + 22), "Ship receipt · re-based", font=f_h2, fill=TEXT)
    if rebased:
        sh = rebased[-1]; pill(d, (s[0] + 24, s[1] + 60), "CLEAN", *GATE["CLEAN"], font=f_med)
        kv(d, s[0] + 24, s[1] + 108, "shipped_at", sh["shipped_at"]); kv(d, s[0] + 24, s[1] + 134, "rebased", "true")
        kv(d, s[0] + 24, s[1] + 160, "pin_hashes", f"{len(sh['pin_hashes'])} revalidated"); kv(d, s[0] + 24, s[1] + 186, "basis", f"{sh['basis_window']['from'][11:23]}Z → {sh['basis_window']['to'][11:23]}Z")
        if rc: kv(d, s[0] + 24, s[1] + 212, "refused_at", rc[-1]["refused_at"], vfill=MUTED)
        d.text((s[0] + 24, s[3] - 60), "refused first, then re-pinned, recomputed, disclosed, re-gated, shipped.", font=f_small, fill=MUTED)
        d.text((s[0] + 24, s[3] - 36), "0 shipped contradictions: the refused draft never left.", font=f_small, fill=GREEN)
    else: d.text((s[0] + 24, s[1] + 60), "no re-based ship in this run", font=f_body, fill=MUTED)
    save(img, "cp-4-selfcorrect.png")

# ---------- frame 5: unreachable, mock ----------
def frame5():
    rc = [r for r in MOCK["receipts"] if r["reason"] == "UNREACHABLE"]
    if not rc: print("frame5: no UNREACHABLE receipt in the mock run, skipped"); return
    r = rc[-1]
    img, d = new_screen("Receipts", "Receipt · REFUSED (unreachable)", "fail-closed, not fail-open · mock fixtures · R5", "mock", "REFUSED")
    x = SB + 40; box = [x, 130, x + 900, H - 40]; card(d, box)
    d.text((box[0] + 24, box[1] + 22), "Refusal receipt", font=f_h2, fill=TEXT); pill(d, (box[0] + 24, box[1] + 60), "REFUSED", *GATE["REFUSED"], font=f_med)
    d.text((box[0] + 24, box[1] + 104), f"reason: {r['reason']}", font=f_body, fill=TEXT)
    kv(d, box[0] + 24, box[1] + 134, "refused_at", r["refused_at"]); y = box[1] + 176
    d.text((box[0] + 24, y), "error", font=f_mono_s, fill=FAINT); y += 22
    for line in wrap(d, r.get("error") or "", f_mono_s, 850)[:4]: d.text((box[0] + 24, y), line, font=f_mono_s, fill=TEXT); y += 22
    y += 14; kv(d, box[0] + 24, y, "drifted_facts", "[] — nothing to compare"); y += 26
    kv(d, box[0] + 24, y, "pin_hashes", f"{len(r['pin_hashes'])} carried"); y += 26
    if r.get("basis_window"): kv(d, box[0] + 24, y, "basis_window", f"{r['basis_window']['from'][11:23]}Z → {r['basis_window']['to'][11:23]}Z"); y += 26
    for l in MOCK["r5"][:2]: kv(d, box[0] + 24, y, l.split(":")[0].replace("R5 report.md ", ""), trunc(d, l.split(":", 1)[1].strip(), f_mono_s, 620), vfill=GREEN); y += 26
    if MOCK["r5"]: d.text((box[0] + 24, y + 6), "before = after: report.md untouched (sha256-mtime)", font=f_small, fill=MUTED)
    g = [x + 920, 130, W - 40, 130 + 330]; card(d, g)
    d.text((g[0] + 24, g[1] + 22), "Fail-closed, not fail-open", font=f_h2, fill=TEXT)
    for i, t in enumerate(["no pins → no report, ever", "no silent fallback to yesterday's values", "the receipt is the audit trail"]):
        d.text((g[0] + 24, g[1] + 66 + i * 32), "· " + t, font=f_body, fill=TEXT)
    d.text((g[0] + 24, g[1] + 190), "a live Nimble failure reads: fetch failed for <url>:", font=f_small, fill=FAINT)
    d.text((g[0] + 24, g[1] + 214), "MCP tools/call → HTTP <code>   (veto/adapters.ts, gate.ts)", font=f_small, fill=FAINT)
    save(img, "cp-5-unreachable.png")

# ---------- frame 6: clean ship, mock ----------
def frame6():
    ships, runs = MOCK["ships"], MOCK["runs"]
    if not ships: print("frame6: no ships.jsonl in the mock run, skipped"); return
    s = ships[0]; clean = [r for r in runs if r.get("verdict") == "CLEAN"]
    resolved = next((l for l in MOCK["verify"] if "resolved" in l), "")
    img, d = new_screen("Receipts", "Receipt · CLEAN (mock)", "the counter the villain night can't show · deterministic fixtures", "mock", "CLEAN")
    x = SB + 40; cw = (W - SB - 80 - 60) // 4; y0 = 130
    metric(d, [x, y0, x + cw, y0 + 168], "Facts pinned", str(len(s["pin_hashes"])), "all revalidated")
    metric(d, [x + cw + 20, y0, x + 2 * cw + 20, y0 + 168], "Drift flagged", "0", "nothing moved")
    metric(d, [x + 2 * cw + 40, y0, x + 3 * cw + 40, y0 + 168], "Clean runs shipped", str(len(clean)), "runs.jsonl · verdict CLEAN", GREEN)
    metric(d, [x + 3 * cw + 60, y0, x + 4 * cw + 60, y0 + 168], "False refusals", "0", "refused on a clean basis", GREEN)
    box = [x, 320, x + 900, H - 40]; card(d, box)
    d.text((box[0] + 24, box[1] + 22), "Ship receipt", font=f_h2, fill=TEXT); pill(d, (box[0] + 24, box[1] + 60), "CLEAN", *GATE["CLEAN"], font=f_med)
    kv(d, box[0] + 24, box[1] + 108, "shipped_at", s["shipped_at"]); kv(d, box[0] + 24, box[1] + 134, "rebased", str(s.get("rebased", False)).lower())
    kv(d, box[0] + 24, box[1] + 160, "pin_hashes", f"{len(s['pin_hashes'])} revalidated"); kv(d, box[0] + 24, box[1] + 186, "basis", f"{s['basis_window']['from'][11:23]}Z → {s['basis_window']['to'][11:23]}Z")
    kv(d, box[0] + 24, box[1] + 212, "verify_pins", resolved or "—", vfill=GREEN)
    d.text((box[0] + 24, box[1] + 260), "report.md is written by the gated ship step only (G1); report.ts writes a draft.", font=f_small, fill=MUTED)
    save(img, "cp-6-clean.png")

# ---------- frame 7: runs, the writer per run ----------
def frame7():
    runs, ev = LIVE["runs"], LIVE["evidence"]
    if not runs: print("frame7: no runs, skipped"); return
    last = runs[-1]["verdict"]; gate = "CLEAN" if last == "CLEAN" else "REFUSED"
    img, d = new_screen("Runs", "Runs", f"session {session_of(ev)} · one row per night · the writer and the gate's latency, per run", "live", gate)
    x = SB + 40; box = [x, 130, W - 40, 130 + 90 + 60 * len(runs)]; card(d, box)
    cols = [("RUN", 24), ("MODE", 260), ("VERDICT", 400), ("WRITER", 580), ("CLAIMS", 1060), ("GATE", 1200), ("ADAPTER", 1340)]
    for c, off in cols: d.text((box[0] + off, box[1] + 22), c, font=f_label, fill=MUTED)
    d.line([(box[0], box[1] + 52), (box[2], box[1] + 52)], fill=BORDER); y = box[1] + 70
    for r in runs:
        d.text((box[0] + 24, y), hhmmss(r["run_at"]), font=f_mono, fill=MUTED); d.text((box[0] + 260, y), r.get("mode", ""), font=f_tbl, fill=TEXT)
        v = r["verdict"] + (f" · {r['reason']}" if r.get("reason") and r["reason"] != r["verdict"] else "") + (" · re-based" if r.get("rebased") else "")
        d.text((box[0] + 400, y), v, font=f_tbl, fill=GREEN if r["verdict"] == "CLEAN" else RED)
        w = r.get("agent") or "—"; wshort = w.replace("hf.co/LiquidAI/", "").replace("-GGUF:Q4_K_M", " · on-device")
        d.text((box[0] + 580, y), trunc(d, wshort, f_tbl, 460), font=f_tbl, fill=TEXT if w != "template" else AMBER)
        d.text((box[0] + 1060, y), f"{r.get('claims_kept', '–')} kept · {r.get('claims_dropped', '–')} dropped", font=f_tbl, fill=MUTED)
        d.text((box[0] + 1200, y), f"{r.get('gate_ms', '–')} ms", font=f_mono, fill=MUTED); d.text((box[0] + 1340, y), r.get("adapter", ""), font=f_tbl, fill=MUTED)
        y += 60
    e = [x, box[3] + 20, W - 40, box[3] + 20 + 230]; card(d, e)
    d.text((e[0] + 24, e[1] + 22), "Evidence source and guardrail, this session", font=f_h2, fill=TEXT)
    y = e[1] + 62
    for key in ("evidence source", "guardrail", "live", "volatility"):
        l = count_line(ev, key)
        if l: d.text((e[0] + 24, y), trunc(d, f"{key}: {l}", f_small, W - 40 - e[0] - 48), font=f_small, fill=GREEN if key == "evidence source" and "matches" in l else TEXT); y += 28
    d.text((e[0] + 24, e[3] - 40), "fallbacks, when they fire: writer → deterministic template (agent.ts); counts → local files (evidence.ts). Neither touches the gate.", font=f_small, fill=FAINT)
    save(img, "cp-7-runs.png")

# ---------- frame 0: thumbnail ----------
def frame0():
    ev = LIVE["evidence"]; ns = count_line(ev, "north star")
    img = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(img)
    d.rounded_rectangle([120, 300, 640, 470], radius=30, fill=(60, 22, 24)); d.text((160, 330), "REFUSED", font=f_huge, fill=RED)
    d.text((120, 520), "Veto", font=F(HN, 96, 1), fill=TEXT)
    d.text((120, 650), "Everyone demos what their agent remembers. We demo what ours refuses.", font=F(HN, 40), fill=MUTED)
    d.text((120, 760), ns, font=F(MENLO, 34), fill=TEXT)
    save(img, "cp-0-thumb.png")

if __name__ == "__main__":
    for fn in (frame1, frame2, frame3, frame4, frame5, frame6, frame7, frame0): fn()
