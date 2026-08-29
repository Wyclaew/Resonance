import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../store/useSettingsStore";

// ═══════════════════════════════════════════════════════════════════════════
// MİNİ OYNATICI KÖPRÜSÜ — iki pencerenin ORTAK sözleşmesi.
//
// ⚠️ Mini pencere AYRI bir JS bağlamıdır: zustand store'unu, veritabanını ve
// ayarları görmez. Bu yüzden durumu ana pencere `mini-state` olayıyla iter,
// mini de kullanıcı eylemlerini `mini-command` olayıyla geri yollar. Tipler
// burada tek yerde durur ki iki taraf birbirinden sessizce ayrılmasın.
// ═══════════════════════════════════════════════════════════════════════════

export interface MiniState {
  title: string;
  artist: string;
  thumbnail?: string;
  /** "idle" | "loading" | "playing" | "paused" */
  status: string;
  volume: number;
  muted: boolean;
  /** Sıradaki parça (boşsa kuyruk bitti). */
  nextTitle: string;
  nextArtist: string;
  /** Oy verilebilir mi (parçanın bir liste/Keşfet bağlamı var mı)? */
  canVote: boolean;
  /** Ana pencerede o an GEÇERLİ olan tema/vurgu — mini aynısını uygular. */
  theme: string;
  accent: string;
  lang: string;
  /** Son çalma hatası (varsa mini'de kırmızı satır). */
  error?: string;
}

export type MiniCommand =
  | { action: "sync" }
  | { action: "toggle" }
  | { action: "next" }
  | { action: "prev" }
  | { action: "seek"; ms: number }
  | { action: "volume"; value: number }
  | { action: "mute" }
  | { action: "vote"; dir: 1 | -1 }
  | { action: "showMain" }
  | { action: "geometry"; x: number; y: number; compact: boolean };

/** Mini pencerenin iki boyu. Genişletilmiş: kapak + sıradaki + ses. */
export const MINI_SIZES = {
  full: { w: 372, h: 152 },
  compact: { w: 372, h: 64 },
};

interface Geometry {
  x?: number;
  y?: number;
  compact?: boolean;
}

function readGeometry(): Geometry {
  const raw = useSettingsStore.getState().miniGeometry;
  if (!raw) return {};
  try {
    const g = JSON.parse(raw);
    return typeof g === "object" && g ? g : {};
  } catch {
    return {}; // bozuk kayıt varsayılana düşsün, açılışı engellemesin
  }
}

/** Mini pencereyi açar/kapatır; son konum ve boyu geri yükler. */
export async function toggleMiniPlayer(): Promise<void> {
  const g = readGeometry();
  const size = g.compact ? MINI_SIZES.compact : MINI_SIZES.full;
  await invoke("toggle_mini_player", {
    x: g.x,
    y: g.y,
    w: size.w,
    h: size.h,
  });
}

/** Mini taşındığında/boy değiştirdiğinde çağrılır (ANA pencere tarafında). */
export function saveMiniGeometry(patch: Geometry): void {
  const next = { ...readGeometry(), ...patch };
  void useSettingsStore.getState().update("miniGeometry", JSON.stringify(next));
}
