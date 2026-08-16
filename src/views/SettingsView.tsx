import { useState, useEffect, useRef } from "react";
import {
  Play,
  HardDrive,
  Keyboard,
  Plug,
  Palette,
  Database,
  Brain,
  Info,
  ChevronDown,
  X,

  Trash2,
  Download,
  Upload,
  Check,
  RefreshCw,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import ViewHeader from "../components/ViewHeader";
import Toggle from "../components/Toggle";
import Confetti from "../components/Confetti";
import { CatDrawing, HeartDrawing } from "../components/SecretCat";
import Logo from "../components/Logo";
import { useSettingsStore } from "../store/useSettingsStore";
import { useT, type TrKey } from "../lib/i18n";
import { useLibraryStore } from "../store/useLibraryStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { getDb, isTauri } from "../lib/db";
import { formatBytes } from "../lib/format";
import { importBackup, type ImportResult } from "../lib/backup";
import { loadBlockedArtists, unblockArtist } from "../lib/blocked";

// label yerine çeviri ANAHTARI — dil değişince kategori adları da değişsin.
const categories = [
  { id: "playback", labelKey: "settings.catPlayback", icon: Play },
  { id: "storage", labelKey: "settings.catStorage", icon: HardDrive },
  { id: "shortcuts", labelKey: "settings.catShortcuts", icon: Keyboard },
  { id: "integrations", labelKey: "settings.catIntegrations", icon: Plug },
  { id: "appearance", labelKey: "settings.catAppearance", icon: Palette },
  { id: "algorithm", labelKey: "settings.catRecommendation", icon: Brain },
  { id: "data", labelKey: "settings.catData", icon: Database },
  { id: "about", labelKey: "settings.catAbout", icon: Info },
] as const satisfies readonly { id: string; labelKey: TrKey; icon: unknown }[];

type CatId = (typeof categories)[number]["id"];

function SettingRow({
  label,
  description,
  children,
  disabled,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-6 border-b border-border py-4 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="mt-0.5 text-xs leading-relaxed text-muted">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// Engellenen sanatçılar — "bu sanatçıyı önerme" dediklerini geri alabilmek
// için tek yer. Liste senkronlanır (blocked_artists tablosu).
function BlockedArtists() {
  const t = useT();
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    void loadBlockedArtists(true).then((s) => setList([...s].sort()));
  }, []);
  if (list.length === 0) return null;
  return (
    <>
      <div className="mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {t("settings.blockedHeader")}
      </div>
      <p className="mb-2 text-xs text-muted">{t("settings.blockedDesc")}</p>
      <div className="flex flex-wrap gap-1.5">
        {list.map((a) => (
          <button
            key={a}
            onClick={async () => {
              await unblockArtist(a);
              setList((l) => l.filter((x) => x !== a));
            }}
            title={t("settings.unblock")}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-down hover:text-down"
          >
            {a}
            <X size={11} />
          </button>
        ))}
      </div>
    </>
  );
}

function AlgorithmSettings() {
  const t = useT();
  const s = useSettingsStore();
  const noSource = !s.recYouTube && !s.recLibrary;

  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm leading-relaxed text-muted">
        {t("settings.recIntro")}
      </p>

      <SettingRow
        label={t("settings.recTitle")}
        description={t("settings.recDesc")}
      >
        <Toggle
          checked={s.recEnabled}
          onChange={(v) => s.update("recEnabled", v)}
        />
      </SettingRow>

      <div className="mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {t("settings.recSourcesHeader")}
      </div>

      <SettingRow
        label={t("settings.recYouTube")}
        description={t("settings.recYouTubeDesc")}
        disabled={!s.recEnabled}
      >
        <Toggle
          checked={s.recYouTube}
          disabled={!s.recEnabled}
          onChange={(v) => s.update("recYouTube", v)}
        />
      </SettingRow>

      <SettingRow
        label={t("settings.recLibrary")}
        description={t("settings.recLibraryDesc")}
        disabled={!s.recEnabled}
      >
        <Toggle
          checked={s.recLibrary}
          disabled={!s.recEnabled}
          onChange={(v) => s.update("recLibrary", v)}
        />
      </SettingRow>

      {s.recEnabled && noSource && (
        <p className="mt-3 text-xs text-down">
          {t("settings.recNoSource")}
        </p>
      )}

      <div className="mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {t("settings.karmaHeader")}
      </div>
      <SettingRow
        label={t("settings.karmaHalfLife")}
        description={t("settings.karmaHalfLifeDesc")}
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={365}
            value={s.karmaHalfLifeDays}
            onChange={(e) =>
              s.update(
                "karmaHalfLifeDays",
                Math.max(1, Math.min(365, Number(e.target.value) || 30))
              )
            }
            className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm outline-none focus:border-border-strong"
          />
          <span className="text-xs text-muted">{t("settings.days")}</span>
        </div>
      </SettingRow>

      <BlockedArtists />
    </div>
  );
}

// macOS dışında Safari yok; Windows'ta seçilirse yt-dlp çerez bulamaz.
// (Backend yine de çerez hatasında çerezsiz tekrar dener, ama listede
// göstermemek daha doğru.)
const IS_MAC =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

// NOT: modül seviyesi → t() burada çağrılamaz. "Kapalı" seçeneği render'da eklenir.
const BROWSERS = [
  ...(IS_MAC ? [{ v: "safari", label: "Safari" }] : []),
  { v: "chrome", label: "Chrome" },
  { v: "brave", label: "Brave" },
  { v: "edge", label: "Edge" },
  { v: "firefox", label: "Firefox" },
  { v: "opera", label: "Opera" },
  { v: "opera-gx", label: "Opera GX" },
  { v: "vivaldi", label: "Vivaldi" },
];

function IntegrationsSettings() {
  const t = useT();
  const cookiesBrowser = useSettingsStore((s) => s.cookiesBrowser);
  const spotifyClientId = useSettingsStore((s) => s.spotifyClientId);
  const spotifyClientSecret = useSettingsStore((s) => s.spotifyClientSecret);
  const update = useSettingsStore((s) => s.update);
  const [updating, setUpdating] = useState(false);
  const [ytdlpMsg, setYtdlpMsg] = useState<string | null>(null);

  async function updateYtdlp() {
    if (!isTauri()) return;
    setUpdating(true);
    setYtdlpMsg(null);
    try {
      const ver = await invoke<string>("update_ytdlp");
      setYtdlpMsg(`Güncellendi ✓ ${ver ? `(sürüm ${ver})` : ""}`);
    } catch (e) {
      setYtdlpMsg(`Hata: ${String(e)}`);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        YouTube
      </div>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        {t("settings.ytCookiesIntro")}
      </p>
      <SettingRow
        label={t("settings.cookiesBrowser")}
        description={t("settings.cookiesBrowserDesc")}
      >
        <div className="relative">
          <select
            value={cookiesBrowser}
            onChange={(e) => update("cookiesBrowser", e.target.value)}
            className="w-44 cursor-pointer appearance-none rounded-md border border-border bg-surface py-1.5 pl-3 pr-9 text-sm text-text outline-none transition-colors hover:border-border-strong focus:border-border-strong"
          >
            <option value="">{t("settings.off")}</option>
            {BROWSERS.map((b) => (
              <option key={b.v} value={b.v}>
                {b.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={15}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
        </div>
      </SettingRow>

      <SettingRow
        label={t("settings.updateYtdlp")}
        description={t("settings.updateYtdlpDesc")}
      >
        <button
          onClick={updateYtdlp}
          disabled={updating}
          className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-3 disabled:opacity-40"
        >
          <RefreshCw size={14} className={updating ? "animate-spin" : ""} />
          {updating ? t("settings.updating") : t("settings.update")}
        </button>
      </SettingRow>
      {ytdlpMsg && (
        <p
          className={`mt-2 text-xs ${
            ytdlpMsg.startsWith("Hata") ? "text-down" : "text-up"
          }`}
        >
          {ytdlpMsg}
        </p>
      )}

      <div className="mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        Spotify
      </div>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        {t("settings.spotifyIntro")}
      </p>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        {t("settings.spotifyOptional")} {t("settings.spotifyKeysHelp")}
      </p>
      <SettingRow label="Client ID" description={t("settings.clientIdDesc")}>
        <input
          value={spotifyClientId}
          onChange={(e) => update("spotifyClientId", e.target.value.trim())}
          placeholder={t("settings.spotifyIdPlaceholder")}
          className="w-56 rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-border-strong"
        />
      </SettingRow>
      <SettingRow label="Client Secret" description={t("settings.spotifySecretHint")}>
        <input
          type="password"
          value={spotifyClientSecret}
          onChange={(e) => update("spotifyClientSecret", e.target.value.trim())}
          placeholder="••••••••"
          className="w-56 rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-border-strong"
        />
      </SettingRow>
    </div>
  );
}

function PlaybackSettings() {
  const t = useT();
  const s = useSettingsStore();
  const [autostart, setAutostart] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    isEnabled()
      .then(setAutostart)
      .catch(() => {});
  }, []);
  async function toggleAutostart(v: boolean) {
    try {
      if (v) await enable();
      else await disable();
      setAutostart(v);
    } catch {
      /* yoksay */
    }
  }
  return (
    <div className="max-w-2xl">
      <SettingRow
        label={t("settings.rememberVolume")}
        description={t("settings.rememberVolumeDesc")}
      >
        <Toggle
          checked={s.rememberVolume}
          onChange={(v) => s.update("rememberVolume", v)}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.prefetch")}
        description={t("settings.prefetchDesc")}
      >
        <Toggle
          checked={s.prefetchEnabled}
          onChange={(v) => s.update("prefetchEnabled", v)}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.autostart")}
        description={t("settings.autostartDesc")}
      >
        <Toggle checked={autostart} onChange={toggleAutostart} />
      </SettingRow>
    </div>
  );
}

function StorageSettings() {
  const t = useT();
  const downloadedIds = useLibraryStore((st) => st.downloadedIds);
  const refreshLibrary = useLibraryStore((st) => st.refresh);
  const [files, setFiles] = useState<{ sourceId: string; bytes: number }[]>([]);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);
  const cacheLimitGb = useSettingsStore((st) => st.cacheLimitGb);
  const audioQuality = useSettingsStore((st) => st.audioQuality);
  const autoDownloadTop = useSettingsStore((st) => st.autoDownloadTop);
  const updateSetting = useSettingsStore((st) => st.update);

  async function load() {
    if (!isTauri()) return;
    setFiles(await invoke("cache_files"));
  }
  useEffect(() => {
    refreshLibrary();
    load();
  }, [refreshLibrary]);

  const dlSourceIds = new Set(
    [...downloadedIds].map((id) => id.split(":").pop() ?? "")
  );
  let cacheBytes = 0,
    cacheCount = 0,
    dlBytes = 0,
    dlCount = 0;
  for (const f of files) {
    if (dlSourceIds.has(f.sourceId)) {
      dlBytes += f.bytes;
      dlCount++;
    } else {
      cacheBytes += f.bytes;
      cacheCount++;
    }
  }

  async function clearCache() {
    setClearing(true);
    setCleared(null);
    const res = await invoke<{ deletedBytes: number; deletedCount: number }>(
      "delete_cache_except",
      { keep: [...dlSourceIds] }
    );
    setCleared(
      `${res.deletedCount} dosya (${formatBytes(res.deletedBytes)}) temizlendi`
    );
    await load();
    setClearing(false);
  }

  return (
    <div className="max-w-2xl">
      <SettingRow
        label={t("settings.tempCache")}
        description={t("settings.tempCacheDesc")}
      >
        <span className="tnum text-sm text-muted">
          {formatBytes(cacheBytes)} ·{" "}
          {t("playlist.trackCount", { count: cacheCount })}
        </span>
      </SettingRow>
      <SettingRow
        label={t("settings.audioQuality")}
        description={t("settings.audioQualityDesc")}
      >
        <select
          value={audioQuality}
          onChange={(e) => {
            const q = e.target.value as "high" | "medium" | "low";
            updateSetting("audioQuality", q);
            invoke("set_audio_quality", { quality: q }).catch(() => {});
          }}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        >
          <option value="high">{t("settings.qualityHigh")}</option>
          <option value="medium">{t("settings.qualityMedium")}</option>
          <option value="low">{t("settings.qualityLow")}</option>
        </select>
      </SettingRow>
      <SettingRow
        label={t("settings.autoDownload")}
        description={t("settings.autoDownloadDesc")}
      >
        <select
          value={autoDownloadTop}
          onChange={(e) =>
            updateSetting("autoDownloadTop", Number(e.target.value))
          }
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        >
          {[0, 20, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? t("settings.off") : t("settings.topN", { n })}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label={t("settings.cacheLimit")}
        description={t("settings.cacheLimitDesc")}
      >
        <select
          value={cacheLimitGb}
          onChange={(e) => updateSetting("cacheLimitGb", Number(e.target.value))}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        >
          {[1, 2, 5, 10, 0].map((g) => (
            <option key={g} value={g}>
              {g === 0 ? t("settings.cacheLimitOff") : `${g} GB`}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label={t("settings.downloadsKept")}
        description={t("settings.downloadsKeptDesc")}
      >
        <span className="tnum text-sm text-muted">
          {formatBytes(dlBytes)} ·{" "}
          {t("playlist.trackCount", { count: dlCount })}
        </span>
      </SettingRow>
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={clearCache}
          disabled={clearing || cacheCount === 0}
          className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm font-medium text-text hover:bg-surface-3 disabled:opacity-40"
        >
          <Trash2 size={15} /> {t("settings.clearCache")}
        </button>
        {cleared && (
          <span className="flex items-center gap-1 text-xs text-up">
            <Check size={14} /> {cleared}
          </span>
        )}
      </div>
    </div>
  );
}

// [tuş anahtarı | düz tuş, açıklama anahtarı]
const SHORTCUTS: [TrKey | { raw: string }, TrKey][] = [
  ["settings.scSpace", "settings.scPlayPause"],
  [{ raw: "→ / ←" }, "settings.scSeek"],
  [{ raw: "Shift + → / ←" }, "settings.scNextPrev"],
  [{ raw: "↑ / ↓" }, "settings.scVolume"],
  [{ raw: "M" }, "settings.scMute"],
  [{ raw: "⌘/Ctrl + K" }, "settings.scPalette"],
  [{ raw: "⌘/Ctrl + B" }, "settings.scSidebar"],
  ["settings.scMediaKeys", "settings.scMediaKeysDesc"],
];
function ShortcutsSettings() {
  const t = useT();
  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm text-muted">{t("settings.scIntro")}</p>
      {SHORTCUTS.map(([k, d]) => (
        <div
          key={d}
          className="flex items-center justify-between border-b border-border py-3 text-sm"
        >
          <span className="text-muted">{t(d)}</span>
          <kbd className="rounded border border-border bg-surface px-2 py-0.5 font-mono text-xs text-text">
            {typeof k === "string" ? t(k) : k.raw}
          </kbd>
        </div>
      ))}
      <p className="mt-4 text-xs text-faint">{t("settings.scNote")}</p>
    </div>
  );
}

const ACCENTS: { v: string; labelKey: TrKey }[] = [
  { v: "#e0a33c", labelKey: "settings.amber" },
  { v: "#5fb87f", labelKey: "settings.green" },
  { v: "#3fb0a8", labelKey: "settings.teal" },
  { v: "#4f9bd9", labelKey: "settings.blue" },
  { v: "#6f7de0", labelKey: "settings.indigo" },
  { v: "#b07ad9", labelKey: "settings.purple" },
  { v: "#e0667f", labelKey: "settings.pink" },
  { v: "#d4634e", labelKey: "settings.red" },
  { v: "#d98a4f", labelKey: "settings.orange" },
];
const SCREENSAVER_OPTS: { v: number; labelKey: TrKey }[] = [
  { v: 0, labelKey: "settings.off" },
  { v: 30, labelKey: "settings.sec30" },
  { v: 60, labelKey: "settings.min1" },
  { v: 90, labelKey: "settings.min15" },
  { v: 180, labelKey: "settings.min3" },
  { v: 300, labelKey: "settings.min5" },
];
function AppearanceSettings() {
  const t = useT();
  const accentColor = useSettingsStore((s) => s.accentColor);
  const screensaverSeconds = useSettingsStore((s) => s.screensaverSeconds);
  const update = useSettingsStore((s) => s.update);

  const presetValues = SCREENSAVER_OPTS.map((o) => o.v);
  const isCustomValue =
    screensaverSeconds > 0 && !presetValues.includes(screensaverSeconds);
  const [customMode, setCustomMode] = useState(isCustomValue);
  const selectVal = customMode ? "custom" : String(screensaverSeconds);

  return (
    <div className="max-w-2xl">
      <SettingRow
        label={t("settings.accentColor")}
        description={t("settings.accentColorDesc")}
      >
        <div className="flex items-center gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.v}
              title={t(a.labelKey)}
              onClick={() => update("accentColor", a.v)}
              className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                accentColor === a.v ? "border-text" : "border-transparent"
              }`}
              style={{ backgroundColor: a.v }}
            />
          ))}
        </div>
      </SettingRow>
      <SettingRow
        label={t("settings.screensaver")}
        description={t("settings.screensaverDesc")}
      >
        <div className="flex items-center gap-2">
          {customMode && (
            <input
              type="number"
              min={0.25}
              step={0.25}
              value={+(screensaverSeconds / 60).toFixed(2)}
              onChange={(e) => {
                const mins = Math.max(0, Number(e.target.value) || 0);
                update("screensaverSeconds", Math.round(mins * 60));
              }}
              title={t("settings.minutes")}
              className="w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-border-strong"
            />
          )}
          {customMode && <span className="text-xs text-muted">dk</span>}
          <div className="relative">
            <select
              value={selectVal}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "custom") {
                  setCustomMode(true);
                  // Bir presete denk gelmiyorsa makul bir başlangıç ver.
                  if (!isCustomValue) update("screensaverSeconds", 120);
                } else {
                  setCustomMode(false);
                  update("screensaverSeconds", Number(v));
                }
              }}
              className="w-40 cursor-pointer appearance-none rounded-md border border-border bg-surface py-1.5 pl-3 pr-9 text-sm text-text outline-none transition-colors hover:border-border-strong focus:border-border-strong"
            >
              {SCREENSAVER_OPTS.map((o) => (
                <option key={o.v} value={o.v}>
                  {t(o.labelKey)}
                </option>
              ))}
              <option value="custom">{t("settings.custom")}</option>
            </select>
            <ChevronDown
              size={15}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
          </div>
        </div>
      </SettingRow>
      {/* Tema ve dil BİLEREK BURADA DEĞİL — profil menüsünde (sidebar altı).
          İki yerde tutmak, birini değiştirip diğerini unutmaya davetiye. */}
    </div>
  );
}

interface BackupInfo {
  path: string;
  name: string;
  bytes: number;
  modifiedMs: number;
}

function DataSettings() {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  // Tarih biçimi dil ayarını izlesin (eskiden "tr-TR"e sabitti).
  const locale = lang === "tr" ? "tr-TR" : "en-US";
  const [exporting, setExporting] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [confirmRestore, setConfirmRestore] = useState<BackupInfo | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setSavedPath(null);
    setImportResult(null);
    setImporting(true);
    try {
      const text = await file.text();
      const r = await importBackup(text);
      setImportResult(r);
      // Mağazaları tazele ki içe aktarılanlar anında görünsün.
      await Promise.all([
        useLibraryStore.getState().refresh(),
        usePlaylistStore.getState().refresh(),
      ]);
    } catch (e) {
      setErr(String(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function loadBackups() {
    if (!isTauri()) return;
    try {
      setBackups(await invoke<BackupInfo[]>("list_backups"));
    } catch {
      /* yoksay */
    }
  }
  useEffect(() => {
    loadBackups();
  }, []);

  async function backupNow() {
    if (!isTauri()) return;
    try {
      await invoke("backup_db");
      await loadBackups();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function exportData() {
    if (!isTauri()) return;
    setExporting(true);
    setErr(null);
    setSavedPath(null);
    try {
      const db = await getDb();
      const [playlists, playlistTracks, tracks, votes, settings] =
        await Promise.all([
          // deleted=0 ŞART: silinmiş satırlar (tombstone) da dışa aktarılırsa,
          // içe aktarma onları deleted=0 ile geri yazıp SİLDİĞİN LİSTELERİ
          // DİRİLTİR.
          db.select("SELECT * FROM playlists WHERE deleted = 0"),
          db.select("SELECT * FROM playlist_tracks WHERE deleted = 0"),
          db.select("SELECT * FROM tracks"),
          db.select("SELECT * FROM votes WHERE deleted = 0"),
          db.select("SELECT * FROM settings"),
        ]);
      const json = JSON.stringify(
        {
          version: 1,
          exportedAt: Date.now(),
          playlists,
          playlistTracks,
          tracks,
          votes,
          settings,
        },
        null,
        2
      );
      setSavedPath(await invoke<string>("export_data", { json }));
    } catch (e) {
      setErr(String(e));
    }
    setExporting(false);
  }

  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm leading-relaxed text-muted">{t("data.intro")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={exportData}
          disabled={exporting}
          className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-40"
        >
          <Download size={15} /> {t("data.exportBackup")}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="flex items-center gap-2 rounded-md bg-surface-2 px-4 py-2 text-sm font-medium text-text hover:bg-surface-3 disabled:opacity-40"
        >
          <Upload size={15} /> {importing ? t("data.importing") : t("data.importBtn")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={onImportFile}
        />
      </div>
      {savedPath && (
        <p className="mt-3 break-all text-xs text-up">{t("data.saved", { path: savedPath })}</p>
      )}
      {importResult && (
        <p className="mt-3 text-xs text-up">
          {t("data.imported", {
            playlists: importResult.playlists,
            tracks: importResult.tracks,
            votes: importResult.votes,
          })}
        </p>
      )}
      {err && <p className="mt-3 text-xs text-down">{err}</p>}

      <div className="mt-8 mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          {t("data.autoBackups")}
        </div>
        <button
          onClick={backupNow}
          className="rounded-md bg-surface-2 px-2.5 py-1 text-xs font-medium text-text hover:bg-surface-3"
        >
          {t("data.backupNow")}
        </button>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        {t("data.autoBackupsDesc")}
      </p>
      {backups.length === 0 ? (
        <p className="text-xs text-faint">{t("data.noBackups")}</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {backups.map((b) => (
            <div
              key={b.path}
              className="flex items-center justify-between px-3 py-2"
            >
              <div>
                <div className="text-sm text-text">
                  {new Date(b.modifiedMs).toLocaleString(locale)}
                </div>
                <div className="tnum text-xs text-faint">
                  {formatBytes(b.bytes)}
                </div>
              </div>
              <button
                onClick={() => setConfirmRestore(b)}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface hover:text-text"
              >
                {t("data.restore")}
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmRestore && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/50"
          onClick={() => setConfirmRestore(null)}
        >
          <div
            className="w-96 animate-pop-in rounded-lg border border-border bg-surface-2 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">{t("data.restoreTitle")}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {t("data.restoreBody", {
                date: new Date(confirmRestore.modifiedMs).toLocaleString(locale),
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmRestore(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-text"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() =>
                  invoke("restore_backup", { path: confirmRestore.path }).catch(
                    () => {}
                  )
                }
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
              >
                {t("data.restoreAndRestart")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// İmza easter egg'i: adı 7 kez tıkla → gizli kedi + kalp ortaya çıkar.
const CAT_CLICKS = 7;

function AboutSettings() {
  const t = useT();
  const [version, setVersion] = useState("");
  const [clicks, setClicks] = useState(0);
  const [party, setParty] = useState(false);
  const unlocked = clicks >= CAT_CLICKS;

  useEffect(() => {
    if (!isTauri()) return;
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  function tapSignature() {
    const n = clicks + 1;
    setClicks(n);
    // 7'de açılır; sonraki her tıklama konfetiyi tekrar patlatır.
    if (n >= CAT_CLICKS) setParty(true);
  }

  return (
    // flex-col + min-h-full: kedi `mt-auto` ile en alta itilir, `justify-end`
    // ile en sağa. ABSOLUTE KULLANMA — kaydırma kabı (overflow-y-auto) absolute
    // konumlanan kediyi KIRPIYORDU (sadece kafası görünüyordu).
    <div className="flex h-full min-h-full flex-col text-sm leading-relaxed text-muted">
      {party && <Confetti onDone={() => setParty(false)} />}
      <div className="max-w-2xl">

      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-md bg-accent/15 text-accent">
          <Logo className="h-7 w-7" />
        </div>
        <div>
          <div className="text-base font-semibold text-text">Resonance</div>
          <div className="text-xs text-faint">
            {t("settings.version")} {version || "—"}
          </div>
        </div>
      </div>
      <p className="mt-4">{t("about.tagline")}</p>
      <p className="mt-3 text-faint">{t("about.disclaimer")}</p>
      <p className="mt-3 text-faint">{t("about.builtWith")}</p>

      {/* İmza. Kedi açılana kadar HİÇBİR ipucu yok — gerçek easter egg. */}
      <div className="mt-6 flex items-center gap-2 border-t border-border pt-4">
        <span className="text-xs uppercase tracking-wider text-faint">
          {t("about.madeBy")}
        </span>
        <button
          onClick={tapSignature}
          className="cursor-pointer font-mono text-sm font-medium tracking-tight text-accent transition-transform active:scale-95"
        >
          Wyclaew
        </button>
      </div>
      </div>

      {/* Gizli kedi + kalp — sayfanın EN SAĞ ALTI, playbar'ın hemen üstü.
          mt-auto: aradaki tüm boşluğu yiyip kediyi dibe iter.
          Kedi `text-text` → koyu temada beyaz, açık temada siyah. */}
      {unlocked && (
        <div className="mt-auto flex shrink-0 justify-end pb-2 pr-1 pt-8" aria-hidden>
          <div className="flex animate-pop-in items-end gap-1.5">
            <CatDrawing className="h-12 w-12 shrink-0 text-text" />
            <HeartDrawing className="mb-1 h-4 w-4 shrink-0 text-down" />
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsView() {
  const t = useT();
  const [active, setActive] = useState<CatId>("playback");
  const current = categories.find((c) => c.id === active)!;

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={t("settings.title")} />
      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 overflow-y-auto px-4 py-1">
          {categories.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                onClick={() => setActive(c.id)}
                className={`mb-0.5 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  active === c.id
                    ? "bg-surface-2 text-text"
                    : "text-muted hover:bg-surface hover:text-text"
                }`}
              >
                <Icon size={16} className={active === c.id ? "text-accent" : ""} />
                {t(c.labelKey)}
              </button>
            );
          })}
        </nav>

        {/* flex-col: başlık sabit, içerik KALAN alanı alır. Böylece bir bölüm
            (Hakkında) "min-h-full" deyince başlığın yüksekliği ÜSTÜNE binmez —
            eskiden binerdi ve alta yaslanan kedi katlanmanın altında kalıyordu. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 py-2">
          <h2 className="mb-4 shrink-0 text-lg font-semibold">
            {t(current.labelKey)}
          </h2>
          <div className="flex min-h-0 flex-1 flex-col">
            {active === "playback" ? (
            <PlaybackSettings />
          ) : active === "storage" ? (
            <StorageSettings />
          ) : active === "shortcuts" ? (
            <ShortcutsSettings />
          ) : active === "integrations" ? (
            <IntegrationsSettings />
          ) : active === "appearance" ? (
            <AppearanceSettings />
          ) : active === "algorithm" ? (
            <AlgorithmSettings />
          ) : active === "data" ? (
            <DataSettings />
          ) : (
            <AboutSettings />
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
