import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../types";
import { getDb, isTauri } from "./db";
import { isBlocked } from "./blocked";
import { queriesFor } from "./filters";
import { isLikelySong, shuffleArray, songCore } from "./recommender";

// ═══════════════════════════════════════════════════════════════════════════
// RADYO AYARLAYICI (v1.9.8) — "seçtiğim sanatçılardan, benim ayarlarımla".
//
// Kullanıcı birkaç sanatçı seçer ve iki ayar verir:
//  • TANIDIKLIK: bildiklerim ↔ karışık ↔ yeni keşifler
//  • ENERJİ: sakin ↔ fark etmez ↔ hareketli
//
// Kaynak: seçilen her sanatçının YouTube Music RADYOSU (Keşfet'teki gibi metin
// araması değil — radyo yapısı gereği yalnız şarkı döner).
//
// ⚠️ ENERJİ YAKLAŞIKTIR: veritabanında tempo/enerji verisi YOK. Ruh hali,
// YouTube Music'in küratörlü "sakin" / "enerjik" listelerinden öğrenilir:
// o listelerde görünen sanatçıların parçaları öne alınır, karşıt listede
// görünenler geri itilir. Sanatçının tamamı tek bir ruh hâlinde değildir;
// bu yüzden bir eğilim, kesin bir filtre değil.
//
// Öğrenmeye etkisi: istasyon dinlemeleri NORMAL dinleme sayılır (sanatçıları
// kullanıcı kendisi seçti — filtreli Keşfet'in tersine bu gerçek bir tercih).
// ═══════════════════════════════════════════════════════════════════════════

export type Familiarity = "known" | "mixed" | "new";
export type Energy = "calm" | "any" | "upbeat";

export interface StationConfig {
  artists: string[];
  familiarity: Familiarity;
  energy: Energy;
}

const LAST_KEY = "resonance.lastStation";
const SIZE = 50;

export function loadLastStation(): StationConfig | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as StationConfig) : null;
  } catch {
    return null;
  }
}

function saveLastStation(c: StationConfig): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(c));
  } catch {
    /* yalnız kolaylık */
  }
}

/** Kütüphanedeki sanatçılar (dinleme + liste sayısına göre) — öneri listesi. */
export async function libraryArtists(): Promise<string[]> {
  if (!isTauri()) return [];
  const db = await getDb();
  const rows = await db.select<{ artist: string; n: number }[]>(
    `SELECT t.artist AS artist, COUNT(*) AS n
       FROM tracks t
       LEFT JOIN play_history h ON h.track_id = t.id
      WHERE t.artist <> '' AND t.title <> ''
      GROUP BY lower(t.artist)
      ORDER BY n DESC
      LIMIT 400`
  );
  return rows.map((r) => r.artist);
}

const norm = (s: string) =>
  s.toLowerCase().replace(/\s*-\s*topic$/i, "").replace(/vevo$/i, "").replace(/[^a-z0-9çğıöşü]+/gi, "");

/** Başlıktaki "Sanatçı - Şarkı" önekiyle gerçek sanatçı (kanal adı yerine). */
function realArtist(t: Track): string {
  const dash = t.title.split(/\s[-–—]\s/);
  return dash.length > 1 && dash[0].trim().length >= 2 ? dash[0].trim() : t.artist;
}

/** Sanatçı için radyo tohumu: önce kendi en çok dinlediğin parçası, yoksa arama. */
async function seedFor(artist: string): Promise<string | null> {
  const db = await getDb();
  const own = await db.select<{ source_id: string }[]>(
    `SELECT t.source_id FROM tracks t
       LEFT JOIN play_history h ON h.track_id = t.id
      WHERE lower(t.artist) = lower($1) AND t.source = 'youtube'
      GROUP BY t.id ORDER BY COUNT(h.id) DESC LIMIT 1`,
    [artist]
  );
  if (own[0]?.source_id) return own[0].source_id;
  try {
    const res = await invoke<Track[]>("search_youtube", {
      query: artist,
      limit: 8,
      cookiesBrowser: "",
    });
    const key = norm(artist);
    const hit =
      res.find((r) => isLikelySong(r) && (norm(r.artist).includes(key) || norm(r.title).includes(key))) ??
      res.find((r) => isLikelySong(r));
    return hit?.sourceId ?? null;
  } catch {
    return null;
  }
}

async function moodArtists(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const q of queriesFor(ids).slice(0, 2)) {
    try {
      const pool = await invoke<Track[]>("music_genre_pool", { query: q, limit: 60 });
      for (const t of pool) out.add(norm(realArtist(t)));
    } catch {
      /* ağ yoksa enerji eğilimi uygulanmaz */
    }
  }
  return out;
}

export async function buildStation(cfg: StationConfig): Promise<Track[]> {
  if (!isTauri() || cfg.artists.length === 0) return [];
  saveLastStation(cfg);
  const db = await getDb();

  // Bilinenler: LİSTENDE olan ya da 30 sn'den uzun DİNLEDİĞİN parçalar.
  // ⚠️ `tracks` tablosunun TAMAMI değil: orada Keşfet'te birkaç saniye çalıp
  // geçtiğin her şey de var. İlk sürüm onu kullandı ve "Yeni keşifler"
  // modunda 100 adaydan yalnız 12 şarkı kaldı (ölçüldü, test paketi).
  const known = await db.select<{ id: string; title: string; artist: string }[]>(
    `SELECT t.id, t.title, t.artist FROM tracks t
      WHERE t.title <> '' AND (
        EXISTS (SELECT 1 FROM playlist_tracks pt WHERE pt.track_id = t.id AND pt.deleted = 0)
        OR EXISTS (SELECT 1 FROM play_history h WHERE h.track_id = t.id AND h.ms_played > 30000)
      )`
  );
  const knownIds = new Set(known.map((k) => k.id));
  const knownCores = new Set(known.map((k) => songCore(k.title, k.artist)));
  const knownArtists = new Set(known.map((k) => norm(k.artist)));
  const chosen = new Set(cfg.artists.map(norm));

  // Tohumlar ve radyolar (3'erli dalgalar — yt-dlp eşzamanlılık sınırı).
  const seeds = (await Promise.all(cfg.artists.slice(0, 5).map(seedFor))).filter(
    (x): x is string => !!x
  );
  const radios: Track[][] = [];
  for (let i = 0; i < seeds.length; i += 3) {
    const wave = await Promise.all(
      seeds.slice(i, i + 3).map((id) =>
        invoke<Track[]>("music_radio", { videoId: id, limit: 50 }).catch(() => [] as Track[])
      )
    );
    radios.push(...wave.map((w) => shuffleArray(w)));
  }

  // Enerji eğilimi.
  const want =
    cfg.energy === "calm" ? ["calm"] : cfg.energy === "upbeat" ? ["energetic", "party"] : [];
  const avoid =
    cfg.energy === "calm" ? ["energetic", "party"] : cfg.energy === "upbeat" ? ["calm"] : [];
  const [wantSet, avoidSet] = await Promise.all([moodArtists(want), moodArtists(avoid)]);

  // Bildiklerim: seçilen sanatçıların KENDİ kütüphane parçaları da girer.
  const own: Track[] =
    cfg.familiarity === "known"
      ? (
          await db.select<Track[]>(
            `SELECT id, source, source_id AS sourceId, title, artist,
                    duration_ms AS durationMs, thumbnail
               FROM tracks WHERE title <> '' AND source = 'youtube'`
          )
        ).filter((t) => chosen.has(norm(t.artist)))
      : [];

  type Cand = { t: Track; score: number };
  const cands: Cand[] = [];
  const seen = new Set<string>();
  const add = (t: Track, base: number) => {
    if (seen.has(t.id) || !isLikelySong(t) || isBlocked(realArtist(t))) return;
    const core = songCore(t.title, t.artist);
    const isKnown = knownIds.has(t.id) || knownCores.has(core);
    const a = norm(realArtist(t));
    if (cfg.familiarity === "new" && isKnown) return;
    let score = base + Math.random();
    if (cfg.familiarity === "known") score += (isKnown ? 2 : 0) + (knownArtists.has(a) ? 1 : 0);
    if (cfg.familiarity === "new") score += knownArtists.has(a) ? -0.5 : 0.5;
    if (wantSet.has(a)) score += 1.2;
    if (avoidSet.has(a)) score -= 1.2;
    seen.add(t.id);
    cands.push({ t, score });
  };
  for (const t of shuffleArray(own)) add(t, 1);
  // Round-robin: her radyodan sırayla — tek sanatçıya kaymasın.
  const longest = Math.max(0, ...radios.map((r) => r.length));
  for (let i = 0; i < longest; i++) for (const r of radios) if (r[i]) add(r[i], 0);

  // ⭐ İKİNCİ TUR: aday az kaldıysa (dar ayar, çok eleme) ilk turun en iyi
  // birkaç YENİ parçasının radyolarını da aç → istasyon hedefe yaklaşır ve
  // seçilen sanatçıların çevresinde genişler.
  if (cands.length < SIZE * 1.5) {
    const hop = [...cands]
      .sort((a, b) => b.score - a.score)
      .map((c) => c.t.sourceId)
      .filter((id) => id && !seeds.includes(id))
      .slice(0, 3);
    const more = await Promise.all(
      hop.map((id) =>
        invoke<Track[]>("music_radio", { videoId: id, limit: 50 }).catch(() => [] as Track[])
      )
    );
    const moreRadios = more.map((w) => shuffleArray(w));
    const longest2 = Math.max(0, ...moreRadios.map((r) => r.length));
    for (let i = 0; i < longest2; i++) for (const r of moreRadios) if (r[i]) add(r[i], -0.3);
  }

  // Sırala, sanatçı çeşitliliği: kişi başına en fazla 2 (seçilenler 3).
  cands.sort((a, b) => b.score - a.score);
  const perArtist = new Map<string, number>();
  const cores = new Set<string>();
  const out: Track[] = [];
  for (const { t } of cands) {
    if (out.length >= SIZE) break;
    const a = norm(realArtist(t));
    const cap = chosen.has(a) ? 3 : 2;
    if ((perArtist.get(a) ?? 0) >= cap) continue;
    const core = songCore(t.title, t.artist);
    if (cores.has(core)) continue; // aynı şarkının başka yüklemesi
    cores.add(core);
    perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
    out.push(t);
  }
  // Sıra çok "en iyi önce" olmasın: hafif karıştır ama ilk 5 öne kalsın.
  return spreadSameArtist([...out.slice(0, 5), ...shuffleArray(out.slice(5))]);
}

/** Aynı sanatçı art arda gelmesin (ilk test: Olivia Dean iki kez üst üste). */
function spreadSameArtist(list: Track[]): Track[] {
  const out = [...list];
  for (let i = 1; i < out.length; i++) {
    if (norm(realArtist(out[i])) !== norm(realArtist(out[i - 1]))) continue;
    const j = out.findIndex(
      (t, k) =>
        k > i &&
        norm(realArtist(t)) !== norm(realArtist(out[i - 1])) &&
        (k + 1 >= out.length || norm(realArtist(out[k + 1])) !== norm(realArtist(out[i])))
    );
    if (j > i) [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
