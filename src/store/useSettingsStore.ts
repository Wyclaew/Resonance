import { create } from "zustand";
import { isTauri } from "../lib/db";
import { loadSettings, setSetting } from "../lib/settings";
import { DEFAULT_HALF_LIFE_DAYS } from "../lib/karma";
import { detectLang, type Lang } from "../lib/i18n";

export type Theme = "dark" | "light" | "system";

// Uygulama ayarları (kalıcı). M6'da genişleyecek; şimdilik öneri + karma.
export interface Settings {
  recEnabled: boolean; // Resonance önerileri araya eklensin mi
  recYouTube: boolean; // öneri kaynağı: YouTube benzerleri
  recLibrary: boolean; // öneri kaynağı: kendi playlistlerin/indirdiklerin
  recEveryN: number; // kaç şarkıda bir öneri eklensin
  karmaHalfLifeDays: number; // karma decay yarı ömrü
  cookiesBrowser: string; // YouTube girişi için tarayıcı ("" = kapalı)
  spotifyClientId: string; // Spotify API client_id
  spotifyClientSecret: string; // Spotify API client_secret
  accentColor: string; // vurgu rengi (CSS hex)
  rememberVolume: boolean; // ses düzeyini hatırla
  savedVolume: number; // hatırlanan ses düzeyi
  prefetchEnabled: boolean; // sıradakini önceden indir
  screensaverSeconds: number; // kaç sn etkileşimsizlikte ambiyans ekranı (0=kapalı)
  /** Ses önbelleği üst sınırı (GB). 0 = sınırsız. İndirilenler ASLA silinmez. */
  cacheLimitGb: number;
  /** İndirme ses kalitesi. "low" ≈ 48k (dosyalar ~3 kat küçük), "high" ≈ 128k. */
  audioQuality: "high" | "medium" | "low";
  /** Profil avatarı (data URI). YERELDE kalır — settings senkronlanmıyor. */
  avatarDataUrl: string;
  /** En çok dinlenen kaç şarkı otomatik indirilsin (çevrimdışı). 0 = kapalı. */
  autoDownloadTop: number;
  resumeState: string; // son çalan şarkı + pozisyon (JSON) — kaldığın yerden devam
  language: Lang; // arayüz dili ("tr" | "en")
  theme: Theme; // "dark" | "light" | "system"
  onboardingDone: boolean; // ilk açılış rehberi gösterildi mi
}

const DEFAULTS: Settings = {
  recEnabled: true,
  recYouTube: true,
  recLibrary: true,
  recEveryN: 3,
  karmaHalfLifeDays: DEFAULT_HALF_LIFE_DAYS,
  cookiesBrowser: "",
  spotifyClientId: "",
  spotifyClientSecret: "",
  accentColor: "#e0a33c",
  rememberVolume: true,
  savedVolume: 0.9,
  prefetchEnabled: true,
  screensaverSeconds: 90,
  cacheLimitGb: 2,
  audioQuality: "high" as "high" | "medium" | "low",
  avatarDataUrl: "",
  autoDownloadTop: 0,
  resumeState: "",
  language: detectLang(),
  theme: "system", // sistem tercihini izle (kullanıcının isteği)
  onboardingDone: false,
};

// Ayar alanı ↔ DB anahtarı eşlemesi.
const KEYS: Record<keyof Settings, string> = {
  recEnabled: "rec.enabled",
  recYouTube: "rec.source.youtube",
  recLibrary: "rec.source.library",
  recEveryN: "rec.everyN",
  karmaHalfLifeDays: "karma.halfLifeDays",
  cookiesBrowser: "yt.cookiesBrowser",
  spotifyClientId: "spotify.clientId",
  spotifyClientSecret: "spotify.clientSecret",
  accentColor: "appearance.accent",
  rememberVolume: "playback.rememberVolume",
  savedVolume: "playback.savedVolume",
  prefetchEnabled: "playback.prefetch",
  screensaverSeconds: "appearance.screensaverSeconds",
  cacheLimitGb: "storage.cacheLimitGb",
  audioQuality: "storage.audioQuality",
  avatarDataUrl: "profile.avatarDataUrl",
  autoDownloadTop: "storage.autoDownloadTop",
  resumeState: "playback.resumeState",
  language: "appearance.language",
  theme: "appearance.theme",
  onboardingDone: "app.onboardingDone",
};

interface SettingsState extends Settings {
  ready: boolean;
  load: () => Promise<void>;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  ready: false,

  load: async () => {
    if (!isTauri()) {
      set({ ready: true });
      return;
    }
    try {
      const raw = await loadSettings();
      const next: Partial<Settings> = {};
      (Object.keys(KEYS) as (keyof Settings)[]).forEach((k) => {
        const v = raw[KEYS[k]];
        if (v === undefined) return;
        if (typeof DEFAULTS[k] === "boolean") {
          (next as any)[k] = v === "1" || v === "true";
        } else if (typeof DEFAULTS[k] === "number") {
          (next as any)[k] = Number(v);
        } else {
          (next as any)[k] = v;
        }
      });
      set({ ...next, ready: true });
    } catch (e) {
      console.error("[resonance] ayarlar yüklenemedi:", e);
      set({ ready: true });
    }
  },

  update: async (key, value) => {
    set({ [key]: value } as Pick<Settings, typeof key>);
    if (!isTauri()) return;
    const str =
      typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    try {
      await setSetting(KEYS[key], str);
    } catch (e) {
      console.error("[resonance] ayar kaydedilemedi:", e);
    }
    void get; // (ileride türetilmiş alanlar için)
  },
}));
