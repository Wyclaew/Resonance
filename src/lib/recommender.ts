import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../types";
import { getDb, isTauri } from "./db";
import { decayWeight } from "./karma";
import { useSettingsStore } from "../store/useSettingsStore";

// Resonance öneri motoru (M4).
// "Hangi gün/saat hangi şarkıya oy verdin" sinyalinden sanatçı yakınlığı
// çıkarır; o anki bağlama (saat/gün) ağırlık verir. Adaylar kendi
// kütüphanenden ve/veya YouTube benzerlerinden gelir.

export interface Recommendation extends Track {
  recSource: "youtube" | "library";
  reason: string;
}

interface VoteRow {
  track_id: string;
  value: number;
  created_at: number;
  hour: number;
  dow: number;
  artist: string;
}

interface CandidateRow {
  id: string;
  source: string;
  source_id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number;
  thumbnail: string | null;
}

function isWeekend(dow: number): boolean {
  return dow === 0 || dow === 6;
}

// Şarkı kimlik anahtarı (başlık+sanatçı, normalize). Aynı şarkının farklı
// YouTube video id'lerini de eşleştirir → mevcut listedeki bir parçanın
// "başka bir kaydı" öneri olarak gelmesin.
function normKey(title: string, artist: string): string {
  return `${title} ${artist}`
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "") // (Official Video), [HD] vb.
    .replace(/[^a-z0-9çğıöşü]+/gi, "")
    .trim();
}

// O anki bağlama (saat/gün) yakınlık ağırlığı.
function contextWeight(
  voteHour: number,
  voteDow: number,
  curHour: number,
  curDow: number
): number {
  const dh = Math.abs(voteHour - curHour);
  const circDh = Math.min(dh, 24 - dh);
  const hourW = Math.exp(-circDh / 3); // ~3 saat içinde güçlü
  const dowW =
    voteDow === curDow ? 1 : isWeekend(voteDow) === isWeekend(curDow) ? 0.6 : 0.35;
  return hourW * dowW;
}

const dayName = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

function toTrack(r: CandidateRow): Track {
  return {
    id: r.id,
    source: r.source as Track["source"],
    sourceId: r.source_id,
    title: r.title,
    artist: r.artist,
    album: r.album ?? undefined,
    durationMs: r.duration_ms,
    thumbnail: r.thumbnail ?? undefined,
  };
}

export interface RecommendOpts {
  playlistId: string;
  excludeIds: Set<string>;
  limit: number;
  useYouTube: boolean;
  useLibrary: boolean;
  halfLifeDays: number;
}

export async function getRecommendations(
  opts: RecommendOpts
): Promise<Recommendation[]> {
  if (!isTauri()) return [];
  const db = await getDb();
  const now = Date.now();
  const d = new Date();
  const curHour = d.getHours();
  const curDow = d.getDay();

  // 1) Oy sinyalinden bağlam-ağırlıklı sanatçı yakınlığı.
  const votes = await db.select<VoteRow[]>(
    `SELECT v.track_id, v.value, v.created_at, v.hour, v.dow, t.artist
     FROM votes v JOIN tracks t ON t.id = v.track_id`
  );
  const artistAffinity = new Map<string, number>();
  const trackKarma = new Map<string, number>();
  for (const v of votes) {
    const w =
      v.value *
      decayWeight(now - v.created_at, opts.halfLifeDays) *
      contextWeight(v.hour, v.dow, curHour, curDow);
    artistAffinity.set(v.artist, (artistAffinity.get(v.artist) ?? 0) + w);
    trackKarma.set(v.track_id, (trackKarma.get(v.track_id) ?? 0) + w);
  }

  const recs: Recommendation[] = [];
  const taken = new Set<string>(opts.excludeIds);

  // Mevcut çalan listedeki şarkıların başlık+sanatçı anahtarları. Öneriler bu
  // listeden (farklı video id'li aynı şarkı dahil) GELMESİN — kullanıcı farklı
  // bir listesi varsa öneriler oradan/kütüphaneden gelir.
  const playlistKeys = new Set<string>();
  const plTrackRows = await db.select<{ title: string; artist: string }[]>(
    `SELECT t.title, t.artist
     FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
     WHERE pt.playlist_id = $1`,
    [opts.playlistId]
  );
  for (const r of plTrackRows) playlistKeys.add(normKey(r.title, r.artist));

  // 2) Kütüphane adayları (mevcut listede olmayan, oy/karma'ya göre puanlı).
  if (opts.useLibrary) {
    const cands = await db.select<CandidateRow[]>(
      `SELECT t.id, t.source, t.source_id, t.title, t.artist, t.album,
              t.duration_ms, t.thumbnail
       FROM tracks t
       WHERE t.id NOT IN (SELECT track_id FROM playlist_tracks WHERE playlist_id = $1)`,
      [opts.playlistId]
    );
    const scored = cands
      .map((c) => {
        const aff = artistAffinity.get(c.artist) ?? 0;
        const tk = trackKarma.get(c.id) ?? 0;
        return { c, score: tk * 1.5 + aff };
      })
      .filter((x) => x.score > 0.05)
      .sort((a, b) => b.score - a.score);

    for (const { c } of scored) {
      if (taken.has(c.id)) continue;
      if (playlistKeys.has(normKey(c.title, c.artist))) continue;
      const aff = artistAffinity.get(c.artist) ?? 0;
      recs.push({
        ...toTrack(c),
        recSource: "library",
        reason:
          aff > 0
            ? `${dayName[curDow]} bu saatlerde ${c.artist} dinliyorsun`
            : `Kütüphanende sevdiğin bir parça`,
      });
      taken.add(c.id);
      if (recs.length >= opts.limit) return recs;
    }
  }

  // 3) YouTube adayları — en yüksek yakınlıklı sanatçılardan (yoksa liste sanatçıları).
  if (opts.useYouTube) {
    let seeds = [...artistAffinity.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([artist]) => artist);

    // Soğuk başlangıç: hiç sinyal yoksa listenin kendi sanatçılarından çek.
    let cold = false;
    if (seeds.length === 0) {
      const plArtists = await db.select<{ artist: string; c: number }[]>(
        `SELECT t.artist, COUNT(*) AS c
         FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = $1 AND t.artist <> ''
         GROUP BY t.artist ORDER BY c DESC LIMIT 2`,
        [opts.playlistId]
      );
      seeds = plArtists.map((r) => r.artist);
      cold = true;
    }

    for (const seed of seeds) {
      if (recs.length >= opts.limit) break;
      try {
        const results = await invoke<Track[]>("search_youtube", {
          query: `${seed} songs`,
          limit: 8,
          cookiesBrowser: useSettingsStore.getState().cookiesBrowser,
        });
        let added = 0;
        for (const r of results) {
          if (taken.has(r.id) || added >= 2) continue;
          if (playlistKeys.has(normKey(r.title, r.artist))) continue;
          recs.push({
            ...r,
            recSource: "youtube",
            reason: cold
              ? `${seed} listendeki sanatçılardan biri`
              : `${dayName[curDow]} bu saatlerde ${seed} seviyorsun`,
          });
          taken.add(r.id);
          added++;
          if (recs.length >= opts.limit) break;
        }
      } catch (e) {
        console.error("[resonance] öneri araması başarısız:", e);
      }
    }
  }

  return recs.slice(0, opts.limit);
}
