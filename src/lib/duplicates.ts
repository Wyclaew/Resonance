import type { PlaylistTrack } from "../types";
import { songCore } from "./recommender";

// ═══════════════════════════════════════════════════════════════════════════
// LİSTEDE TEKRARLAR (v1.9.8) — aynı şarkının birden fazla YÜKLEMESİ.
//
// İçe aktarmada (Spotify/YT Music → YouTube eşleştirmesi) ve elle eklemede
// aynı şarkı "Official Video", "Lyrics", "Topic" yüklemeleriyle iki-üç kez
// girebiliyor. Bunlar AYNI ses, listede yer kaplıyor ve karıştırmada aynı
// şarkı iki kez çalıyor.
//
// ⚠️ AYNI ŞARKI ≠ AYNI KAYIT: "Remix", "Slowed", "Live", "Acoustic", "Cover"…
// BAŞKA bir kayıttır, kullanıcı bilerek ikisini de tutmuş olabilir. `songCore`
// bu etiketleri SİLDİĞİ için tek başına anahtar olamaz → sürüm imzası
// (başlıktaki sürüm etiketleri) anahtara eklenir. Sanatçı da anahtarda: aynı
// adlı başka sanatçının şarkısı tekrar değildir.
//
// Kimin kalacağı ÖNERİLİR (indirilmiş > karma > dinlenme > önce eklenen);
// silme kararı kullanıcınındır ve "Geri al" ile döner.
// ═══════════════════════════════════════════════════════════════════════════

const VERSION_TAGS: [string, RegExp][] = [
  ["remix", /\b(remix|rmx|edit)\b/i],
  ["slowed", /\bslowed\b/i],
  ["sped", /\bsped ?up\b|\bspeed ?up\b/i],
  ["reverb", /\breverb\b/i],
  ["live", /\b(live|canlı|konser|concert)\b/i],
  ["acoustic", /\b(acoustic|akustik|unplugged)\b/i],
  ["cover", /\bcover\b/i],
  ["instrumental", /\b(instrumental|enstrümantal|karaoke)\b/i],
  ["nightcore", /\bnightcore\b/i],
  ["8d", /\b8d\b/i],
];

function versionSignature(title: string): string {
  return VERSION_TAGS.filter(([, re]) => re.test(title))
    .map(([k]) => k)
    .join("+");
}

function flat(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*-\s*topic$/i, "")
    .replace(/vevo$/i, "")
    .replace(/[^a-z0-9çğıöşü]+/gi, "");
}

/** Gerçek sanatçı: "Sanatçı - Şarkı" başlığı varsa baştaki, yoksa kanal adı. */
function artistKey(t: PlaylistTrack): string {
  const dash = t.title.split(/\s[-–—]\s/);
  const name = dash.length > 1 && dash[0].trim().length >= 2 ? dash[0] : t.artist;
  return flat(name);
}

export interface DuplicateGroup {
  key: string;
  tracks: PlaylistTrack[];
  /** Önerilen tutulacak parça. */
  keepId: string;
}

export function findDuplicates(
  tracks: PlaylistTrack[],
  downloaded: Set<string>,
  plays: Map<string, number> = new Map()
): DuplicateGroup[] {
  const groups = new Map<string, PlaylistTrack[]>();
  for (const t of tracks) {
    const core = songCore(t.title, t.artist);
    if (core.replace(/\s/g, "").length < 2) continue; // anlamlı ad yok
    const key = `${core}|${artistKey(t)}|${versionSignature(t.title)}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: DuplicateGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const ranked = [...list].sort(
      (a, b) =>
        Number(downloaded.has(b.id)) - Number(downloaded.has(a.id)) ||
        b.karma - a.karma ||
        (plays.get(b.id) ?? 0) - (plays.get(a.id) ?? 0) ||
        (a.addedAt ?? 0) - (b.addedAt ?? 0)
    );
    out.push({ key, tracks: ranked, keepId: ranked[0].id });
  }
  return out;
}
