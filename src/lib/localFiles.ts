import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Track } from "../types";
import { isTauri } from "./db";
import { t } from "./i18n";
import { createPlaylist, importTracks } from "./playlists";

// ═══════════════════════════════════════════════════════════════════════════
// KENDİ MÜZİK DOSYALARIN
//
// YouTube'da olmayan/kaldırılmış şarkılar, kendi kayıtların, satın aldıkların.
// İnternet gerekmez ve öneri motoru bunları da öğrenir: aynı `tracks`
// tablosuna `source = "local"` olarak yazılırlar, oylar/dinleme geçmişi
// normal parçalarla aynı yoldan işler.
//
// ⚠️ `sourceId` = DOSYA YOLU. Bu yüzden yerel parçalar cihazlar arasında
// senkronlansa bile diğer cihazda ÇALMAZ (dosya orada yok) — tracks satırı
// gider, ses gitmez. Bilinçli: geçmiş/istatistik ortak kalsın, dosya kopyalama
// işine girmeyelim.
// ═══════════════════════════════════════════════════════════════════════════

export interface LocalTrackInfo {
  path: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
}

/** Dosya/klasör seç → tara → Track listesine çevir. */
export async function pickLocalFiles(): Promise<Track[]> {
  if (!isTauri()) return [];
  const picked = await open({
    multiple: true,
    directory: false,
    filters: [
      {
        name: t("import.musicFilter"),
        extensions: ["mp3", "flac", "wav", "ogg", "oga", "m4a", "aac", "opus", "wma", "aiff"],
      },
    ],
  });
  return scanPaths(picked);
}

/** Klasör seç → içindeki tüm ses dosyaları (alt klasörler dahil). */
export async function pickLocalFolder(): Promise<Track[]> {
  if (!isTauri()) return [];
  const picked = await open({ multiple: false, directory: true });
  return scanPaths(picked);
}

async function scanPaths(picked: string | string[] | null): Promise<Track[]> {
  if (!picked) return [];
  const paths = Array.isArray(picked) ? picked : [picked];
  const found = await invoke<LocalTrackInfo[]>("scan_local_files", { paths });
  return found.map(toTrack);
}

function toTrack(l: LocalTrackInfo): Track {
  return {
    // Yol kimliğin kendisi: aynı dosya iki kez eklenirse aynı satır olur.
    id: `local:${l.path}`,
    source: "local",
    sourceId: l.path,
    title: l.title,
    artist: l.artist,
    album: l.album || undefined,
    durationMs: l.durationMs,
  };
}

/** Bulunan parçaları yeni bir çalma listesine yazar. */
export async function importLocalToPlaylist(
  name: string,
  tracks: Track[],
  onProgress?: (done: number, total: number) => void
): Promise<string> {
  const pl = await createPlaylist(name);
  await importTracks(pl.id, tracks, onProgress);
  return pl.id;
}
