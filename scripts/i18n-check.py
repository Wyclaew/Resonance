#!/usr/bin/env python3
"""Resonance ceviri denetimi — 3 katman:
  1) UI ozniteligi: title/placeholder/aria-label/alt="duz metin"   (dilden bagimsiz)
  2) JSX prose metni: >metin<  }metin<  >metin{  (ifadeyle karisik dahil)
  3) Turkce diakritikli string literalleri (ternary'leri yakalar)
Yorumlar, i18n.ts ve console.* satirlari haric (log ceviri gerektirmez)."""
import re, sys, pathlib

ROOT = pathlib.Path("/Users/erne/Desktop/MusicPlayer/src")
SKIP = {"lib/i18n.ts"}
UI_ATTRS = ("title", "placeholder", "aria-label", "alt", "label", "subtitle")
TRC = "çğıöşüÇĞİÖŞÜ"
ALLOW = re.compile(r"^[\s\d\W_]*$|^(Resonance|YouTube|Spotify|yt-dlp|ffmpeg|rodio|Tauri|"
                   r"React|RSNC1|Esc|https?://.*|[A-Za-z]{1,3})$", re.I)
# Prose olmayan (kod) isaretleri
NOTPROSE = re.compile(r"[=(){};<>\[\]]|=>|\.\w|\bconst\b|\blet\b|\breturn\b|\bfunction\b")

def strip_noise(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)          # blok yorum
    src = re.sub(r"^\s*//.*$", "", src, flags=re.M)          # satir yorumu
    src = re.sub(r"^.*console\.\w+\(.*$", "", src, flags=re.M)  # loglar
    return src

def check(path):
    code = strip_noise(path.read_text(encoding="utf-8"))
    out, seen = [], set()
    def add(pos, kind, val):
        line = code[:pos].count("\n") + 1
        if (line, val) in seen: return
        seen.add((line, val)); out.append((line, kind, val[:66]))
    for attr in UI_ATTRS:
        for m in re.finditer(rf'\b{attr}=("([^"\n]+)"|\'([^\'\n]+)\')', code):
            val = (m.group(2) or m.group(3) or "").strip()
            if val and not ALLOW.match(val): add(m.start(), attr, val)
    for m in re.finditer(r"[>}]([^<>{}]+)[<{]", code, flags=re.S):
        val = " ".join(m.group(1).split())
        if not val or ALLOW.match(val) or NOTPROSE.search(val): continue
        if not re.search(r"[A-Za-z" + TRC + r"]", val): continue
        add(m.start(), "jsx", val)
    for m in re.finditer(rf'"([^"\n]*[{TRC}][^"\n]*)"', code):
        val = m.group(1).strip()
        if val: add(m.start(), "literal", val)
    return out

total = 0
for f in sorted(ROOT.rglob("*.ts*")):
    rel = str(f.relative_to(ROOT))
    if rel in SKIP: continue
    fs = check(f)
    if fs:
        print(f"\n── {rel}")
        for line, kind, val in sorted(fs):
            print(f"   {line:4}  [{kind}] {val}")
        total += len(fs)
print(f"\n{'='*54}\nKALAN: {total}")
sys.exit(0 if total == 0 else 1)
