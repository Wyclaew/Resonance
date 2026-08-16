#!/usr/bin/env python3
"""Senkron sema denetimi.

Motorun (src/lib/sync/engine.ts) her tablo icin bekledigi SUTUNLAR ile
sunucu semasinin (docs/supabase-schema.sql) tanimladigi sutunlari karsilastirir.

NEDEN: uygulamaya yeni tablo/sutun eklenip Supabase semasi guncellenmeyince
senkron "Could not find the table ... in the schema cache" ile patliyor ve bu
YALNIZCA calisma aninda, kullanicinin makinesinde goruluyor. Bu betik ayni
sapmayi derleme oncesi yakalar.
"""
import re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
engine = (root / "src/lib/sync/engine.ts").read_text()
schema = (root / "docs/supabase-schema.sql").read_text()

# engine.ts -> { tablo: [sutunlar] }
want = {}
for m in re.finditer(r'name:\s*"([a-z_]+)",(.*?)cols:\s*\[(.*?)\]', engine, re.S):
    tbl, cols = m.group(1), m.group(3)
    want[tbl] = sorted(set(re.findall(r'"([a-z_]+)"', cols)))

# supabase-schema.sql -> { tablo: [sutunlar] }
have = {}
for m in re.finditer(
    r"create table if not exists public\.([a-z_]+)\s*\((.*?)\n\);", schema, re.S | re.I
):
    tbl, body = m.group(1), m.group(2)
    cols = []
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("--") or line.lower().startswith("primary key"):
            continue
        c = re.match(r"([a-z_]+)\s", line)
        if c:
            cols.append(c.group(1))
    have[tbl] = sorted(set(cols))

problems = []
for tbl, cols in want.items():
    if tbl not in have:
        problems.append(f"TABLO YOK sunucu semasinda: {tbl}")
        continue
    missing = [c for c in cols if c not in have[tbl]]
    if missing:
        problems.append(f"{tbl}: sunucuda eksik sutun -> {', '.join(missing)}")

# Sunucuda RLS/realtime/trigger listelerinde her tablo anilmis mi?
for tbl in want:
    for label, needle in (
        ("RLS/trigger/realtime listesi", f"'{tbl}'"),
    ):
        if needle not in schema:
            problems.append(f"{tbl}: {label} icinde gecmiyor")

print("=" * 60)
if problems:
    for p in problems:
        print("  ✗", p)
    print(f"\nSORUN: {len(problems)}")
    sys.exit(1)
print(f"  ✓ {len(want)} tablo, sema motorla uyumlu")
