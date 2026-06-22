import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PlaybackStatus, QueueItem, RepeatMode, Track } from "../types";
import { isTauri } from "../lib/db";

// Oynatıcı durumu — Rust ses motoruna (rodio) Tauri komutlarıyla bağlı.
// Pozisyon/durum, ses thread'inden gelen "playback-tick" olayıyla güncellenir.

interface PlayerState {
  status: PlaybackStatus;
  current: QueueItem | null;
  queue: QueueItem[];
  queueIndex: number;

  positionMs: number;
  durationMs: number;
  volume: number; // 0..1
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;

  error: string | null;

  playNow: (track: Track, queue?: Track[], playlistId?: string) => void;
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

// Bir kuyruk öğesini gerçekten oynat (indir + Rust'a yükle).
function loadAndPlay(item: QueueItem) {
  if (!isTauri()) return;
  invoke("play_track", {
    input: {
      sourceId: item.sourceId,
      durationMs: item.durationMs,
      trackId: item.id,
    },
  }).catch((e) => {
    console.error("[resonance] play_track hatası:", e);
    usePlayerStore.setState({ status: "idle", error: String(e) });
  });
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
  error: null,

  playNow: (track, queue, playlistId) => {
    const items = (queue ?? [track]).map((t) => toQueueItem(t, playlistId));
    const idx = Math.max(
      0,
      items.findIndex((i) => i.id === track.id)
    );
    const current = items[idx];
    set({
      queue: items,
      queueIndex: idx,
      current,
      status: "loading",
      positionMs: 0,
      durationMs: track.durationMs,
      error: null,
    });
    loadAndPlay(current);
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
    const { queue, queueIndex, shuffle, repeat } = get();
    if (queue.length === 0) return;

    if (repeat === "one") {
      const cur = queue[queueIndex];
      set({ status: "loading", positionMs: 0 });
      loadAndPlay(cur);
      return;
    }

    let nextIdx: number;
    if (shuffle) {
      nextIdx =
        queue.length === 1
          ? queueIndex
          : (() => {
              let r = queueIndex;
              while (r === queueIndex) r = Math.floor(Math.random() * queue.length);
              return r;
            })();
    } else {
      nextIdx = queueIndex + 1;
      if (nextIdx >= queue.length) {
        if (repeat === "all") nextIdx = 0;
        else {
          // Kuyruk bitti.
          if (isTauri()) invoke("audio_stop").catch(() => {});
          set({ status: "idle", positionMs: 0 });
          return;
        }
      }
    }
    const item = queue[nextIdx];
    set({ queueIndex: nextIdx, current: item, status: "loading", positionMs: 0, durationMs: item.durationMs });
    loadAndPlay(item);
  },

  prev: () => {
    const { queue, queueIndex, positionMs } = get();
    if (queue.length === 0) return;
    // 3sn'den fazla çaldıysa başa sar; değilse önceki şarkı.
    if (positionMs > 3000) {
      get().seek(0);
      return;
    }
    const prevIdx = queueIndex - 1 < 0 ? 0 : queueIndex - 1;
    const item = queue[prevIdx];
    set({ queueIndex: prevIdx, current: item, status: "loading", positionMs: 0, durationMs: item.durationMs });
    loadAndPlay(item);
  },

  seek: (ms) => {
    set({ positionMs: ms });
    if (isTauri()) invoke("audio_seek", { ms: Math.floor(ms) }).catch(() => {});
  },

  setVolume: (v) => {
    const vol = Math.max(0, Math.min(1, v));
    set({ volume: vol, muted: false });
    if (isTauri()) invoke("audio_set_volume", { volume: vol }).catch(() => {});
  },

  toggleMute: () => {
    const { muted, volume } = get();
    const nextMuted = !muted;
    set({ muted: nextMuted });
    if (isTauri())
      invoke("audio_set_volume", { volume: nextMuted ? 0 : volume }).catch(() => {});
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
      if (playing) patch.status = "playing";
      else if (s.status === "playing") patch.status = "paused";
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
    usePlayerStore.setState({ status: "idle", error: e.payload });
  });
}
