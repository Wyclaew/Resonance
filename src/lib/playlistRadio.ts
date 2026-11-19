import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../types";
import { isBlocked, loadBlockedArtists } from "./blocked";
import { getDb } from "./db";
import { queriesFor } from "./filters";
import {
  artistScore,
  buildPlaylistTaste,
  candidateFit,
  getPlaylistStyle,
  hasStyle,
  isRealPlaylist,
  learnedWeight,
  type PlaylistStyle,
} from "./playlistProfile";
import {
  dislikedCores,
  getRecommendations,
  isLikelySong,
  recordRecommended,
  shuffleArray,
  songCore,
  type Recommendation,
  type RecommendOpts,
} from "./recommender";

/**
 * ⭐ LİSTEYE ÖZEL ÖNERİ — mobildeki `playlistRadio.ts`'in masaüstü karşılığı.
 * Kullanıcı: "spor listemi önerili başlatınca o listedeki gibi şarkılar önersin,
 * zevk profilimden ayrı."
 *
 * Genel motor tohumları HEP genel zevkten seçer; burada tohumlar yalnız listeden,
 * tarzı atanmışsa o tarzın küratörlü havuzundan gelir. Genel zevk karışmaz.
 *
 * ⚠️ "FİLTRE BİR SÜRE SONRA UNUTULMASIN" ÜÇ YERDEN SAĞLANIR:
 *  1. Tarzlı liste genel öneriye HİÇ düşmez.
 *  2. Havuz tekrar engeliyle tükenirse engel gevşetilir (tarz dışına değil, tarzın
 *     içinde tekrar) — Keşfet'te kuyruğu kişisel radyoya bırakan hatanın dersi.
 *  3. Radyo zamanla kayar → havuzun kendisi de iki kaynak olarak döner, ayrıca
 *     listede sonuna kadar dinlenen sanatçılar yeni tohum olur (profil güçlenir).
 */
const SEEDS = 4;
const PER_RADIO = 40;
const PER_ARTIST = 2;
const STYLE_POOL_SEEDS = 3;
const STYLE_MINE_SEEDS = 2;
const STYLE_LEARNED_SEEDS = 1;
const REPEAT_BLOCK_DAYS = 14;
const DISLIKED_SCORE = -2;
const MAX_STYLE_QUERIES = 3;
const RADIO_WAVE = 3;

/** Bu oturumda tohum olmuş parçalar — sıradaki besleme FARKLI tohumlarla gelsin. */
const usedSeeds = new Map<string, Set<string>>();

interface Seed {
  sourceId: string;
  artist: string;
}

interface ListRow {
  id: string;
  source_id: string;
  title: string;
  artist: string;
  weight: number;
}

/**
 * Liste çalarken öneri: sonuç çıkmazsa (ağ, çok küçük liste) tarzsız listede
 * genel motora düşülür ki kuyruk boşalıp müzik durmasın. Tarzlı listede DÜŞÜLMEZ.
 */
export async function recommendFor(
  opts: RecommendOpts
): Promise<Recommendation[]> {
  if (!isRealPlaylist(opts.playlistId)) return getRecommendations(opts);
  const styled = hasStyle(getPlaylistStyle(opts.playlistId));
  try {
    const recs = await playlistRecommendations(opts);
    if (recs.length > 0) {
      if (opts.record !== false) await recordRecommended(recs.map((r) => r.id));
      return recs;
    }
  } catch (e) {
    console.error("[resonance] liste radyosu başarısız:", e);
  }
  return styled ? [] : getRecommendations(opts);
}

function weightedOrder<T>(items: T[], weight: (x: T) => number): T[] {
  return items
    .map((x) => ({
      x,
      key: -Math.log(Math.random() || 1e-9) / Math.max(0.05, weight(x)),
    }))
    .sort((a, b) => a.key - b.key)
    .map((e) => e.x);
}

/** Listenin tarz havuzu: serbest tarzlar + filtre sorguları. */
async function stylePool(style: PlaylistStyle): Promise<Track[]> {
  const queries = [
    ...style.styles.map((s) => s.trim()).filter(Boolean),
    ...queriesFor(style.filters),
  ].slice(0, MAX_STYLE_QUERIES);
  const waves = await Promise.all(
    queries.map((query) =>
      invoke<Track[]>("music_genre_pool", { query, limit: 60 }).catch((e) => {
        console.error("[resonance] tarz havuzu alınamadı:", query, e);
        return [] as Track[];
      })
    )
  );
  const seen = new Set<string>();
  return waves.flat().filter((t) => {
    if (!t.sourceId || seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

async function fetchRadios(seeds: Seed[]): Promise<Track[][]> {
  const radios: Track[][] = [];
  // Aynı anda en fazla 3 yt-dlp (throttle sınırı eşzamanlılıkta).
  for (let i = 0; i < seeds.length; i += RADIO_WAVE) {
    const wave = await Promise.all(
      seeds.slice(i, i + RADIO_WAVE).map((s) =>
        invoke<Track[]>("music_radio", {
          videoId: s.sourceId,
          limit: PER_RADIO,
        }).catch((e) => {
          console.error("[resonance] liste radyosu açılamadı:", s.artist, e);
          return [] as Track[];
        })
      )
    );
    radios.push(...wave);
  }
  return radios;
}

async function playlistRecommendations(
  opts: RecommendOpts
): Promise<Recommendation[]> {
  const playlistId = opts.playlistId;
  const excludeCores = opts.excludeCores ?? new Set<string>();
  const db = await getDb();
  const style = getPlaylistStyle(playlistId);
  const styled = hasStyle(style);
  const [taste, nameRows, rows] = await Promise.all([
    buildPlaylistTaste(playlistId),
    db.select<{ name: string }[]>(`SELECT name FROM playlists WHERE id = $1`, [
      playlistId,
    ]),
    // ⚠️ Oy ağırlığı PARÇAYA aittir, liste süzgeci yok (CLAUDE.md #13b).
    db.select<ListRow[]>(
      `SELECT t.id, t.source_id, t.title, t.artist,
              1 + MAX(0, COALESCE((SELECT SUM(v.value) FROM votes v
                                   WHERE v.track_id = t.id AND v.deleted = 0), 0)) AS weight
       FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = $1 AND pt.deleted = 0
         AND t.source = 'youtube' AND t.title <> ''`,
      [playlistId]
    ),
    loadBlockedArtists(),
  ] as const);
  if (rows.length === 0 && !styled) return [];
  const listName = nameRows[0]?.name ?? "";

  const inList = new Set(rows.map((r) => r.id));
  const listCores = new Set(rows.map((r) => songCore(r.title, r.artist)));
  const listArtists = new Set(rows.map((r) => r.artist.toLowerCase()));
  const disliked = (artist: string) =>
    artistScore(taste, artist) <= DISLIKED_SCORE;

  const seeds: Seed[] = [];
  const seedArtists = new Set<string>();
  const pushSeed = (sourceId: string, artist: string): boolean => {
    const a = artist.toLowerCase();
    if (!sourceId || seedArtists.has(a) || isBlocked(artist) || disliked(artist)) {
      return false;
    }
    seedArtists.add(a);
    seeds.push({ sourceId, artist });
    return true;
  };

  let pool: Track[] = [];
  if (styled) {
    pool = (await stylePool(style)).filter((t) => isLikelySong(t));
    const poolArtists = new Set(pool.map((t) => t.artist.toLowerCase()));
    for (const t of shuffleArray(pool)) {
      if (seeds.length >= STYLE_POOL_SEEDS) break;
      pushSeed(t.sourceId, t.artist);
    }
    let mine = 0;
    for (const r of weightedOrder(
      rows.filter((r) => poolArtists.has(r.artist.toLowerCase())),
      (x) => x.weight * learnedWeight(taste, x.artist)
    )) {
      if (mine >= STYLE_MINE_SEEDS) break;
      if (pushSeed(r.source_id, r.artist)) mine++;
    }
    // Havuzla kesişmese bile bu listede en çok tutan sanatçı: tarz ad veriyor,
    // profil tadını veriyor.
    let learned = 0;
    for (const r of weightedOrder(
      rows.filter((r) => artistScore(taste, r.artist) > 1),
      (x) => learnedWeight(taste, x.artist)
    )) {
      if (learned >= STYLE_LEARNED_SEEDS) break;
      if (pushSeed(r.source_id, r.artist)) learned++;
    }
  } else {
    let used = usedSeeds.get(playlistId);
    if (!used || used.size >= rows.length) {
      used = new Set();
      usedSeeds.set(playlistId, used);
    }
    const usedNow = used;
    for (const r of weightedOrder(
      rows.filter((r) => !usedNow.has(r.source_id)),
      (x) => x.weight * learnedWeight(taste, x.artist)
    )) {
      if (seeds.length >= SEEDS) break;
      if (pushSeed(r.source_id, r.artist)) usedNow.add(r.source_id);
    }
  }
  if (seeds.length === 0 && pool.length === 0) return [];

  const since = Date.now() - REPEAT_BLOCK_DAYS * 24 * 3600 * 1000;
  const recentRows = await db.select<{ track_id: string }[]>(
    `SELECT DISTINCT track_id FROM recommendation_history
     WHERE recommended_at > $1 AND deleted = 0`,
    [since]
  );
  const recent = new Set(recentRows.map((r) => r.track_id));

  const radios = await fetchRadios(seeds);
  const fit = (t: Track) =>
    candidateFit(taste, {
      title: t.title,
      artist: t.artist,
      durationMs: t.durationMs,
    });
  const shuffledPool = weightedOrder(pool, fit);
  const half = Math.ceil(shuffledPool.length / 2);
  // Havuz İKİ kaynak: radyolar kaysa bile her turda tarz garanti.
  const streams: { seed: string; tracks: Track[] }[] = [
    { seed: listName, tracks: shuffledPool.slice(0, half) },
    { seed: listName, tracks: shuffledPool.slice(half) },
    ...radios.map((tracks, i) => ({
      seed: seeds[i]?.artist ?? listName,
      tracks: weightedOrder(tracks, fit),
    })),
  ].filter((s) => s.tracks.length > 0);

  const out: Recommendation[] = [];
  // Açıkça beğenilmeyen şarkılar liste radyosunda da gelmesin.
  const takenCores = await dislikedCores();
  const perArtist = new Map<string, number>();

  const pick = (allowRecent: boolean) => {
    const cursors = streams.map(() => 0);
    let progressed = true;
    while (out.length < opts.limit && progressed) {
      progressed = false;
      for (let i = 0; i < streams.length && out.length < opts.limit; i++) {
        const { seed, tracks } = streams[i];
        while (cursors[i] < tracks.length) {
          const r = tracks[cursors[i]++];
          const core = songCore(r.title, r.artist);
          const a = r.artist.toLowerCase();
          if (
            inList.has(r.id) ||
            opts.excludeIds.has(r.id) ||
            taste.skippedTracks.has(r.id) ||
            (!allowRecent && recent.has(r.id)) ||
            listCores.has(core) ||
            excludeCores.has(core) ||
            takenCores.has(core) ||
            isBlocked(r.artist) ||
            disliked(r.artist) ||
            (perArtist.get(a) ?? 0) >= PER_ARTIST ||
            !isLikelySong(r)
          ) {
            continue;
          }
          takenCores.add(core);
          perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
          out.push({
            ...r,
            recSource: "youtube",
            seedArtist: seed,
            reason: listArtists.has(a)
              ? { key: "rec.fromPlaylist", seed: listName }
              : { key: "rec.newDiscovery", seed: listName, artist: r.artist },
          });
          progressed = true;
          break;
        }
      }
    }
  };

  pick(false);
  if (styled && out.length < opts.limit) pick(true);
  return out;
}
