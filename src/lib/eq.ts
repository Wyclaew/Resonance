// Ekolayzer ayarları (cihaza özel, senkronlanmaz) + Rust'a itme.
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./db";

export const EQ_BANDS = [60, 230, 910, 3600, 14000] as const;
export const EQ_MAX_DB = 12;

export type EqPresetId = "flat" | "bass" | "treble" | "vocal" | "loudness" | "custom";

export interface EqSettings {
  enabled: boolean;
  preset: EqPresetId;
  preampDb: number;
  gains: number[]; // EQ_BANDS ile aynı uzunluk, dB
}

export const EQ_PRESETS: Record<Exclude<EqPresetId, "custom">, number[]> = {
  flat: [0, 0, 0, 0, 0],
  bass: [6, 3, 0, 0, 0],
  treble: [0, 0, 0, 3, 6],
  vocal: [-2, 0, 3, 2, -1],
  loudness: [5, 2, 0, 2, 4],
};

export const EQ_DEFAULT: EqSettings = {
  enabled: false,
  preset: "flat",
  preampDb: 0,
  gains: [0, 0, 0, 0, 0],
};

const clampDb = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, n)) : 0;
};

/** Saklanan JSON'u güvenle çöz; bozuksa varsayılan. */
export function parseEq(raw: string): EqSettings {
  try {
    const o = JSON.parse(raw);
    const gains = Array.isArray(o.gains) ? o.gains : [];
    return {
      enabled: !!o.enabled,
      preset: o.preset in EQ_PRESETS || o.preset === "custom" ? o.preset : "custom",
      preampDb: clampDb(o.preampDb),
      gains: EQ_BANDS.map((_, i) => clampDb(gains[i])),
    };
  } catch {
    return EQ_DEFAULT;
  }
}

/** Ses motoruna it (Rust tarafı kendi içinde de sınırlar). */
export function pushEq(e: EqSettings): void {
  if (!isTauri()) return;
  invoke("audio_set_eq", {
    enabled: e.enabled,
    preampDb: e.preampDb,
    gainsDb: e.gains,
  }).catch((err) => console.warn("[resonance] ekolayzer iletilemedi:", err));
}
