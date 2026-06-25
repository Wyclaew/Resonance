import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PlaybackStatus, QueueItem, RepeatMode, Track } from "../types";
import { isTauri } from "../lib/db";
import { getRecommendations } from "../lib/recommender";
import { recordPlay } from "../lib/history";
import { useSettingsStore } from "./useSettingsStore";
import { useToastStore } from "./useToastStore";

// Oynatıcı durumu — Rust ses motoruna (rodio) Tauri komutlarıyla bağlı.
// Pozisyon/durum, ses thread'inden gelen "playback-tick" olayıyla güncellenir.

type KarmaTrack = Track & { karma?: number };

interface PlayerState {
  status: PlaybackStatus;
  current: QueueItem | null;
  queue: QueueItem[];
  queueIndex: number;

  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;

  // Resonance Radyosu
  radioActive: boolean;
  radioPlaylistId: string | null;
  skippedRecIds: Set<string>;

  // Uyku zamanlayıcı
  sleepTimerEndsAt: number | null;
  setSleepTimer: (minutes: number | null) => void;

  error: string | null;

  playNow: (track: Track, queue?: Track[], playlistId?: string) => void;
  startRadio: (tracks: KarmaTrack[], playlistId: string) => Promise<void>;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
}

const repeatOrder: RepeatMode[] = ["off", "all", "one"];

function toQueueItem(t: Track, playlistId?: string): QueueItem {
  return { ...t, uid: crypto.randomUUID(), playlistId };
}

// Karma ağırlıklı karıştırma: yüksek karma daha öne, downvote'lu geriye.
function weightedShuffle(tracks: KarmaTrack[]): KarmaTrack[] {
  return tracks
    .map((t) => {
      const w = Math.max(0.12, 1 + (t.karma ?? 0) * 0.6);
      // Exponential sıralama anahtarı → ağırlıklı rastgele sıra.
      const key = -Math.log(Math.random()) / w;
      return { t, key };
    })
    .sort((a, b) => a.key - b.key)
    .map((x) => x.t);
}

function loadAndPlay(item: QueueItem) {
  if (!isTauri()) return;
  invoke("play_track", {
    input: {
      sourceId: item.sourceId,
      durationMs: item.durationMs,
      trackId: item.id,
    },
    cookiesBrowser: useSettingsStore.getState().cookiesBrowser,
  }).catch((e) => {
    console.error("[resonance] play_track hatası:", e);
    usePlayerStore.setState({ status: "idle", error: String(e) });
  });
}

let sleepTimeout: ReturnType<typeof setTimeout> | undefined;

// Ses düzeyini ayarlara debounce'lu kaydet (sürükleme sırasında DB'yi yormamak için).
let volSaveTimer: ReturnType<typeof setTimeout> | undefined;
function persistVolume(v: number) {
  const s = useSettingsStore.getState();
  if (!s.rememberVolume) return;
  clearTimeout(volSaveTimer);
  volSaveTimer = setTimeout(() => s.update("savedVolume", v), 600);
}

// Sıradaki parçaları arka planda indir/hazırla → hızlı arka arkaya geçişler de
// anlık olur. 3 önden hazırlanır (zaten cache'tekiler yt-dlp bile çağırmaz).
function prefetchNext() {
  if (!isTauri()) return;
  if (!useSettingsStore.getState().prefetchEnabled) return;
  const { queue, queueIndex } = usePlayerStore.getState();
  const cookiesBrowser = useSettingsStore.getState().cookiesBrowser;
  for (let i = 1; i <= 3; i++) {
    const item = queue[queueIndex + i];
    if (!item) break;
    invoke("prefetch_audio", {
      sourceId: item.sourceId,
      cookiesBrowser,
    }).catch(() => {});
  }
}

// Çıkan parçayı geçmişe yaz + erken geçilen öneriye yumuşak ceza.
function recordOutgoing(s: PlayerState) {
  if (!s.current) return;
  recordPlay(s.current.id, s.positionMs);
  if (
    s.current.isRecommendation &&
    s.positionMs < Math.min(20_000, s.durationMs * 0.3)
  ) {
    const skipped = new Set(s.skippedRecIds);
    skipped.add(s.current.id);
    usePlayerStore.setState({ skippedRecIds: skipped });
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  status: "idle",
  current: null,
  queue: [],
  queueIndex: -1,

  positionMs: 0,
  durationMs: 0,
  volume: 0.9,
  muted: false,
  shuffle: false,
  repeat: "off",

  radioActive: false,
  radioPlaylistId: null,
  skippedRecIds: new Set(),

  sleepTimerEndsAt: null,
  setSleepTimer: (minutes) => {
    clearTimeout(sleepTimeout);
    if (minutes == null) {
      set({ sleepTimerEndsAt: null });
      return;
    }
    const ms = minutes * 60000;
    set({ sleepTimerEndsAt: Date.now() + ms });
    sleepTimeout = setTimeout(() => {
      if (isTauri()) invoke("audio_pause").catch(() => {});
      set({ status: "paused", sleepTimerEndsAt: null });
    }, ms);
  },

  error: null,

  playNow: (track, queue, playlistId) => {
    const items = (queue ?? [track]).map((t) => toQueueItem(t, playlistId));
    const idx = Math.max(0, items.findIndex((i) => i.id === track.id));
    const current = items[idx];
    set({
      queue: items,
      queueIndex: idx,
      current,
      status: "loading",
      positionMs: 0,
      durationMs: track.durationMs,
      radioActive: false,
      radioPlaylistId: null,
      error: null,
    });
    loadAndPlay(current);
    prefetchNext();
  },

  startRadio: async (tracks, playlistId) => {
    if (tracks.length === 0) return;
    const s = useSettingsStore.getState();
    const baseItems = weightedShuffle(tracks).map((t) =>
      toQueueItem(t, playlistId)
    );
    const first = baseItems[0];
    set({
      queue: baseItems,
      queueIndex: 0,
      current: first,
      status: "loading",
      positionMs: 0,
      durationMs: first.durationMs,
      radioActive: true,
      radioPlaylistId: playlistId,
      error: null,
    });
    loadAndPlay(first);
    prefetchNext();

    // Önerileri arka planda getir ve kuyruğa serpiştir (oynatmayı bekletmeden).
    if (!s.recEnabled || (!s.recYouTube && !s.recLibrary)) return;
    try {
      const exclude = new Set([
        ...tracks.map((t) => t.id),
        ...get().skippedRecIds,
      ]);
      const recs = await getRecommendations({
        playlistId,
        excludeIds: exclude,
        limit: Math.max(2, Math.ceil(baseItems.length / s.recEveryN) + 1),
        useYouTube: s.recYouTube,
        useLibrary: s.recLibrary,
        halfLifeDays: s.karmaHalfLifeDays,
      });
      if (recs.length === 0) return;

      set((state) => {
        if (!state.radioActive || state.radioPlaylistId !== playlistId) {
          return {};
        }
        const q = [...state.queue];
        const recItems: QueueItem[] = recs.map((r) => ({
          ...r,
          uid: crypto.randomUUID(),
          playlistId,
          isRecommendation: true,
          recSource: r.recSource,
          recReason: r.reason,
        }));
        // Mevcut konumdan sonra her recEveryN parçada bir öneri ekle.
        let insertAt = state.queueIndex + s.recEveryN + 1;
        let ri = 0;
        while (ri < recItems.length && insertAt <= q.length) {
          q.splice(insertAt, 0, recItems[ri++]);
          insertAt += s.recEveryN + 1;
        }
        while (ri < recItems.length) q.push(recItems[ri++]);
        return { queue: q };
      });
    } catch (e) {
      console.error("[resonance] radyo önerileri alınamadı:", e);
    }
  },

  toggle: () => {
    const { status, current } = get();
    if (!current) return;
    if (status === "playing") {
      if (isTauri()) invoke("audio_pause").catch(() => {});
      set({ status: "paused" });
    } else {
      if (isTauri()) invoke("audio_play").catch(() => {});
      set({ status: "playing" });
    }
  },

  next: () => {
    recordOutgoing(get());
    const { queue, queueIndex, shuffle, repeat, radioActive } = get();
    if (queue.length === 0) return;

    if (repeat === "one") {
      const cur = queue[queueIndex];
      set({ status: "loading", positionMs: 0 });
      loadAndPlay(cur);
      return;
    }

    let nextIdx: number;
    if (shuffle && !radioActive) {
      nextIdx =
        queue.length === 1
          ? queueIndex
          : (() => {
              let r = queueIndex;
              while (r === queueIndex)
                r = Math.floor(Math.random() * queue.length);
              return r;
            })();
    } else {
      nextIdx = queueIndex + 1;
      if (nextIdx >= queue.length) {
        if (repeat === "all") nextIdx = 0;
        else {
          if (isTauri()) invoke("audio_stop").catch(() => {});
          set({ status: "idle", positionMs: 0 });
          return;
        }
      }
    }
    const item = queue[nextIdx];
    set({
      queueIndex: nextIdx,
      current: item,
      status: "loading",
      positionMs: 0,
      durationMs: item.durationMs,
    });
    loadAndPlay(item);
    prefetchNext();
  },

  prev: () => {
    const { queue, queueIndex, positionMs } = get();
    if (queue.length === 0) return;
    if (positionMs > 3000) {
      get().seek(0);
      return;
    }
    recordOutgoing(get());
    const prevIdx = queueIndex - 1 < 0 ? 0 : queueIndex - 1;
    const item = queue[prevIdx];
    set({
      queueIndex: prevIdx,
      current: item,
      status: "loading",
      positionMs: 0,
      durationMs: item.durationMs,
    });
    loadAndPlay(item);
    prefetchNext();
  },

  seek: (ms) => {
    set({ positionMs: ms });
    if (isTauri()) invoke("audio_seek", { ms: Math.floor(ms) }).catch(() => {});
  },

  setVolume: (v) => {
    const vol = Math.max(0, Math.min(1, v));
    set({ volume: vol, muted: false });
    if (isTauri()) invoke("audio_set_volume", { volume: vol }).catch(() => {});
    persistVolume(vol);
  },

  toggleMute: () => {
    const { muted, volume } = get();
    const nextMuted = !muted;
    set({ muted: nextMuted });
    if (isTauri())
      invoke("audio_set_volume", { volume: nextMuted ? 0 : volume }).catch(
        () => {}
      );
  },

  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  cycleRepeat: () => {
    const cur = get().repeat;
    const idx = repeatOrder.indexOf(cur);
    set({ repeat: repeatOrder[(idx + 1) % repeatOrder.length] });
  },
}));

// Ses thread'inden gelen olayları dinle (uygulama açılışında bir kez).
let initialized = false;
export async function initPlayer() {
  if (initialized || !isTauri()) return;
  initialized = true;

  await listen<{ position_ms: number; duration_ms: number; playing: boolean }>(
    "playback-tick",
    (e) => {
      const { position_ms, duration_ms, playing } = e.payload;
      const s = usePlayerStore.getState();
      const patch: Partial<PlayerState> = { positionMs: position_ms };
      if (duration_ms > 0) patch.durationMs = duration_ms;
      if (playing) {
        patch.status = "playing";
        consecutiveErrors = 0; // başarılı çalma → hata sayacını sıfırla
      } else if (s.status === "playing") patch.status = "paused";
      usePlayerStore.setState(patch);
    }
  );

  await listen("track-ended", () => {
    usePlayerStore.getState().next();
  });

  await listen<string>("playback-loading", () => {
    usePlayerStore.setState({ status: "loading" });
  });

  await listen<string>("playback-error", (e) => {
    consecutiveErrors++;
    const s = usePlayerStore.getState();
    // Bozuk/çalınamayan şarkıyı atla (kuyruk takılmasın); art arda 3 hatadan
    // sonra dur ki sonsuz döngü olmasın.
    if (consecutiveErrors <= 3 && s.queue.length > 1) {
      useToastStore.getState().show("Şarkı çalınamadı, atlanıyor", "error");
      s.next();
    } else {
      useToastStore
        .getState()
        .show("Şarkı çalınamadı" + (e.payload ? `: ${e.payload}` : ""), "error");
      usePlayerStore.setState({ status: "idle", error: e.payload });
    }
  });
}

// Art arda çalma hatası sayacı (otomatik atlamada sonsuz döngüyü önler).
let consecutiveErrors = 0;
