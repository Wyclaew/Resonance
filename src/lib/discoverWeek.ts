import type { Track } from "../types";
import { isTauri } from "./db";
import { getRecommendations } from "./recommender";
import { loadSettings, setSetting } from "./settings";
import { useSettingsStore } from "../store/useSettingsStore";
import { notifyLocalChange } from "./sync/engine";

// ═══════════════════════════════════════════════════════════════════════════
// HAFTALIK KEŞİF (v1.9.6) — Spotify'ın "Discover Weekly"si gibi: pazartesileri
// yenilenen, hafta boyunca SABİT kalan 30 şarkılık keşif listesi.
//
// ⚠️ GERÇEK BİR PLAYLIST DEĞİL, bilerek: `playlist_tracks` üyeliği öğrenme
// motorunda "bu sanatçıyı seviyorum" sinyali sayılıyor (CLAUDE.md, öneri
// motoru). Haftalık liste kalıcı listeye yazılsaydı, ALGORİTMANIN KENDİ
// ÖNERİLERİ kendini besleyip zevk profilini şişirirdi. Bu yüzden ayarlarda
// JSON olarak durur ve "akıllı liste" olarak görünür.
//
// Ayar anahtarı SENKRONLANIR → aynı hafta listesi tüm cihazlarda aynı.
// ═══════════════════════════════════════════════════════════════════════════

export const DISCOVER_WEEK_KEY = "discover.week";
const SIZE = 30;

interface WeekState {
  week: string; // o haftanın pazartesisi (YYYY-MM-DD)
  createdAt: number;
  tracks: Track[];
}

/** Bulunduğumuz haftanın pazartesisi — yerel saate göre. */
export function weekStamp(d = new Date()): string {
  const day = (d.getDay() + 6) % 7; // pazartesi = 0
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const dd = String(monday.getDate()).padStart(2, "0");
  return `${monday.getFullYear()}-${m}-${dd}`;
}

async function readState(): Promise<WeekState | null> {
  try {
    const raw = (await loadSettings())[DISCOVER_WEEK_KEY];
    if (!raw) return null;
    const st = JSON.parse(raw) as WeekState;
    return Array.isArray(st.tracks) ? st : null;
  } catch {
    return null;
  }
}

/** Kayıtlı liste (üretmeden). Akıllı liste kartı bunu okur. */
export async function discoverWeekTracks(): Promise<Track[]> {
  const st = await readState();
  return st?.tracks ?? [];
}

export async function discoverWeekInfo(): Promise<{ week: string; count: number } | null> {
  const st = await readState();
  return st ? { week: st.week, count: st.tracks.length } : null;
}

/**
 * Hafta değiştiyse (ya da hiç yoksa) yeni liste üretir. Ağ gerektirir;
 * başarısız olursa eski liste durur — boş liste YAZILMAZ.
 */
export async function ensureDiscoverWeek(force = false): Promise<Track[]> {
  if (!isTauri()) return [];
  const week = weekStamp();
  const st = await readState();
  if (!force && st && st.week === week && st.tracks.length > 0) return st.tracks;

  const settings = useSettingsStore.getState();
  const recs = await getRecommendations({
    playlistId: DISCOVER_WEEK_KEY,
    excludeIds: new Set<string>(),
    limit: SIZE,
    useYouTube: true,
    // ⚠️ Kütüphane kapalı: haftalık liste KEŞİF olmalı, kendi şarkıların değil
    // (favori dönüşü de buradan gelmesin).
    useLibrary: false,
    halfLifeDays: settings.karmaHalfLifeDays,
    record: true,
  });
  if (recs.length === 0) return st?.tracks ?? [];

  const tracks: Track[] = recs.map((r) => ({
    id: r.id,
    source: r.source,
    sourceId: r.sourceId,
    title: r.title,
    artist: r.artist,
    durationMs: r.durationMs,
    thumbnail: r.thumbnail,
  }));
  const next: WeekState = { week, createdAt: Date.now(), tracks };
  await setSetting(DISCOVER_WEEK_KEY, JSON.stringify(next));
  notifyLocalChange();
  console.warn(`[resonance] haftalık keşif hazırlandı (${tracks.length} şarkı, ${week})`);
  return tracks;
}
