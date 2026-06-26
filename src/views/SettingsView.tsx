import { useState, useEffect } from "react";
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
  Cloud,
  Trash2,
  Download,
  Check,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import ViewHeader from "../components/ViewHeader";
import Toggle from "../components/Toggle";
import { useSettingsStore } from "../store/useSettingsStore";
import { useLibraryStore } from "../store/useLibraryStore";
import { getDeviceId } from "../lib/device";
import { getDb, isTauri } from "../lib/db";
import { formatBytes } from "../lib/format";

const categories = [
  { id: "account", label: "Hesap & Senkron", icon: Cloud },
  { id: "playback", label: "Oynatma", icon: Play },
  { id: "storage", label: "Depolama & Önbellek", icon: HardDrive },
  { id: "shortcuts", label: "Kısayollar", icon: Keyboard },
  { id: "integrations", label: "Entegrasyonlar", icon: Plug },
  { id: "appearance", label: "Görünüm", icon: Palette },
  { id: "algorithm", label: "Resonance Önerisi", icon: Brain },
  { id: "data", label: "Veri & Yedek", icon: Database },
  { id: "about", label: "Hakkında", icon: Info },
] as const;

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

function AlgorithmSettings() {
  const s = useSettingsStore();
  const noSource = !s.recYouTube && !s.recLibrary;

  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm leading-relaxed text-muted">
        Resonance, hangi gün ve saatte hangi şarkıya upvote/downvote verdiğini
        öğrenir ve çalma listesi dinlerken araya sana uygun şarkılar ekler.
        Bu öneriler "✦ Resonance" rozetiyle işaretlenir; dilersen geçersin.
      </p>

      <SettingRow
        label="Resonance önerileri"
        description="Çalma listesi dinlerken araya önerilen şarkılar eklensin."
      >
        <Toggle
          checked={s.recEnabled}
          onChange={(v) => s.update("recEnabled", v)}
        />
      </SettingRow>

      <div className="mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        Öneriler nereden gelsin?
      </div>

      <SettingRow
        label="YouTube'dan benzer"
        description="Upvote'ladığın şarkı ve sanatçılara göre YouTube'da benzerlerini bulur. Yeni keşif."
        disabled={!s.recEnabled}
      >
        <Toggle
          checked={s.recYouTube}
          disabled={!s.recEnabled}
          onChange={(v) => s.update("recYouTube", v)}
        />
      </SettingRow>

      <SettingRow
        label="Kendi playlistlerim"
        description="Diğer çalma listelerin ve indirdiklerin arasından o anki bağlama uyanları önerir."
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
          En az bir kaynak açık olmalı, yoksa öneri gelmez.
        </p>
      )}

      <div className="mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        Karma
      </div>
      <SettingRow
        label="Karma yarı ömrü"
        description="Oyların ne kadar sürede yarı değere düşeceği (gün). Düşük = daha hızlı unutur."
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
          <span className="text-xs text-muted">gün</span>
        </div>
      </SettingRow>
    </div>
  );
}

// macOS dışında Safari yok; Windows'ta seçilirse yt-dlp çerez bulamaz.
// (Backend yine de çerez hatasında çerezsiz tekrar dener, ama listede
// göstermemek daha doğru.)
const IS_MAC =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

const BROWSERS = [
  { v: "", label: "Kapalı" },
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
  const cookiesBrowser = useSettingsStore((s) => s.cookiesBrowser);
  const spotifyClientId = useSettingsStore((s) => s.spotifyClientId);
  const spotifyClientSecret = useSettingsStore((s) => s.spotifyClientSecret);
  const update = useSettingsStore((s) => s.update);

  return (
    <div className="max-w-2xl">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        YouTube
      </div>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        YouTube, giriş yapılmadan bir çalma listesinin en fazla ~100 şarkısını
        verir ve özel listelere izin vermez. Tarayıcını seçersen uygulama, o
        tarayıcıdaki YouTube oturumunu (çerezleri) kullanır: <b className="text-text">tüm
        şarkılar (100+)</b>, özel listelerin ve daha az bot engeli. Çerezler
        cihazında kalır, hiçbir yere gönderilmez.
      </p>
      <SettingRow
        label="Hesap için tarayıcı"
        description="Hangi tarayıcıdaki YouTube oturumun kullanılsın? O tarayıcıda YouTube'a giriş yapmış olmalısın."
      >
        <div className="relative">
          <select
            value={cookiesBrowser}
            onChange={(e) => update("cookiesBrowser", e.target.value)}
            className="w-44 cursor-pointer appearance-none rounded-md border border-border bg-surface py-1.5 pl-3 pr-9 text-sm text-text outline-none transition-colors hover:border-border-strong focus:border-border-strong"
          >
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

      <div className="mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        Spotify
      </div>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        Spotify'ın sesi alınamaz; bir Spotify listesini içe aktarınca şarkı
        adları okunur ve <b className="text-text">YouTube'da eşleştirilip</b>{" "}
        oradan çalınır. Bunun için tek seferlik <b className="text-text">ücretsiz</b>{" "}
        bir Spotify API anahtarı gerekir:{" "}
        <span className="text-accent">developer.spotify.com</span> → Dashboard →
        Create app → Client ID ve Client Secret'ı buraya yapıştır (Redirect URI
        zorunlu değil). Anahtarlar cihazında kalır.
      </p>
      <SettingRow label="Client ID" description="Spotify Developer Dashboard'dan">
        <input
          value={spotifyClientId}
          onChange={(e) => update("spotifyClientId", e.target.value.trim())}
          placeholder="örn. 4a1b…"
          className="w-56 rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-border-strong"
        />
      </SettingRow>
      <SettingRow label="Client Secret" description="Gizli tut; kimseyle paylaşma.">
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

function AccountSettings() {
  const deviceId = getDeviceId();
  return (
    <div className="max-w-2xl">
      <div className="rounded-lg border border-accent/30 bg-accent/5 p-5">
        <div className="flex items-center gap-2 text-accent">
          <Cloud size={18} />
          <span className="text-sm font-semibold">Bulut senkronu — yakında</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Yakında bir hesapla giriş yapıp çalma listelerin, oyların/karman ve
          ayarların <b className="text-text">masaüstü, telefon ve web</b> arasında
          otomatik senkronlanacak. Ses her cihazda yerel kalır; buluta yalnızca
          metadata gider. Şu an her şey <b className="text-text">tamamen yerel ve
          gizli</b> — senkron açıldığında bile isteğe bağlı (opt-in) olacak.
        </p>
        <button
          disabled
          className="mt-4 cursor-default rounded-md bg-surface-2 px-4 py-2 text-sm font-medium text-faint"
        >
          Giriş yap (yakında)
        </button>
      </div>

      <div className="mt-5 border-b border-border py-4">
        <div className="text-sm font-medium">Bu cihaz</div>
        <div className="mt-1 font-mono text-xs text-faint">{deviceId}</div>
        <div className="mt-1 text-xs text-muted">
          Senkron açıldığında bu cihazı tanımak için kullanılacak kimlik.
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-faint">
        Planın tamamı depoda <span className="text-muted">docs/SYNC.md</span>{" "}
        dosyasında: Supabase tabanlı hesap + delta senkron, web'de YouTube IFrame
        Player (yt-dlp tarayıcıda çalışmadığı için), mobil için Tauri/Android.
      </p>
    </div>
  );
}

function PlaybackSettings() {
  const s = useSettingsStore();
  return (
    <div className="max-w-2xl">
      <SettingRow
        label="Ses düzeyini hatırla"
        description="Uygulama en son ses düzeyiyle açılır."
      >
        <Toggle
          checked={s.rememberVolume}
          onChange={(v) => s.update("rememberVolume", v)}
        />
      </SettingRow>
      <SettingRow
        label="Sıradakini önceden indir"
        description="Bir sonraki şarkıyı arka planda hazırlar → geçiş anlık olur. Biraz daha veri kullanır."
      >
        <Toggle
          checked={s.prefetchEnabled}
          onChange={(v) => s.update("prefetchEnabled", v)}
        />
      </SettingRow>
    </div>
  );
}

function StorageSettings() {
  const downloadedIds = useLibraryStore((st) => st.downloadedIds);
  const refreshLibrary = useLibraryStore((st) => st.refresh);
  const [files, setFiles] = useState<{ sourceId: string; bytes: number }[]>([]);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);

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
        label="Geçici önbellek"
        description="Çaldığın ama indirmediğin şarkılar. Silmek güvenli; gerekince yeniden alınır."
      >
        <span className="tnum text-sm text-muted">
          {formatBytes(cacheBytes)} · {cacheCount} şarkı
        </span>
      </SettingRow>
      <SettingRow
        label="İndirilenler"
        description="Çevrimdışı için kalıcı tuttukların. Önbellek temizlemede silinmez."
      >
        <span className="tnum text-sm text-muted">
          {formatBytes(dlBytes)} · {dlCount} şarkı
        </span>
      </SettingRow>
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={clearCache}
          disabled={clearing || cacheCount === 0}
          className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm font-medium text-text hover:bg-surface-3 disabled:opacity-40"
        >
          <Trash2 size={15} /> Önbelleği temizle
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

const SHORTCUTS: [string, string][] = [
  ["Boşluk", "Oynat / Duraklat"],
  ["→ / ←", "5 sn ileri / geri"],
  ["Shift + → / ←", "Sonraki / Önceki şarkı"],
  ["↑ / ↓", "Ses +/−"],
  ["M", "Sessize al"],
];
function ShortcutsSettings() {
  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm text-muted">
        Uygulama açıkken (yazı kutuları hariç) geçerli kısayollar:
      </p>
      {SHORTCUTS.map(([k, d]) => (
        <div
          key={k}
          className="flex items-center justify-between border-b border-border py-3 text-sm"
        >
          <span className="text-muted">{d}</span>
          <kbd className="rounded border border-border bg-surface px-2 py-0.5 font-mono text-xs text-text">
            {k}
          </kbd>
        </div>
      ))}
      <p className="mt-4 text-xs text-faint">
        Global kısayollar (uygulama arka plandayken) sonraki sürümde.
      </p>
    </div>
  );
}

const ACCENTS = [
  { v: "#e0a33c", label: "Kehribar" },
  { v: "#5fb87f", label: "Yeşil" },
  { v: "#4f9bd9", label: "Mavi" },
  { v: "#d4634e", label: "Mercan" },
  { v: "#b07ad9", label: "Mor" },
  { v: "#e0667f", label: "Pembe" },
];
function AppearanceSettings() {
  const accentColor = useSettingsStore((s) => s.accentColor);
  const update = useSettingsStore((s) => s.update);
  return (
    <div className="max-w-2xl">
      <SettingRow
        label="Vurgu rengi"
        description="Butonlar ve etkin öğelerdeki vurgu rengi."
      >
        <div className="flex items-center gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.v}
              title={a.label}
              onClick={() => update("accentColor", a.v)}
              className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                accentColor === a.v ? "border-text" : "border-transparent"
              }`}
              style={{ backgroundColor: a.v }}
            />
          ))}
        </div>
      </SettingRow>
      <p className="mt-3 text-xs text-faint">
        Tema koyu; açık tema sonraki sürümde.
      </p>
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
  const [exporting, setExporting] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [confirmRestore, setConfirmRestore] = useState<BackupInfo | null>(null);

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
          db.select("SELECT * FROM playlists"),
          db.select("SELECT * FROM playlist_tracks"),
          db.select("SELECT * FROM tracks"),
          db.select("SELECT * FROM votes"),
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
      <p className="mb-4 text-sm leading-relaxed text-muted">
        Çalma listelerin, oyların/karman ve ayarların bir JSON dosyasına
        yedeklenir (İndirilenler klasörüne). Ses dosyaları dahil değildir.
      </p>
      <button
        onClick={exportData}
        disabled={exporting}
        className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-40"
      >
        <Download size={15} /> Yedeği dışa aktar
      </button>
      {savedPath && (
        <p className="mt-3 break-all text-xs text-up">Kaydedildi: {savedPath}</p>
      )}
      {err && <p className="mt-3 text-xs text-down">{err}</p>}

      <div className="mt-8 mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          Otomatik yedekler
        </div>
        <button
          onClick={backupNow}
          className="rounded-md bg-surface-2 px-2.5 py-1 text-xs font-medium text-text hover:bg-surface-3"
        >
          Şimdi yedekle
        </button>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        Veri varken her açılışta otomatik yedek alınır (son 12 tutulur). Bir
        sorun olursa buradan geri yükleyebilirsin.
      </p>
      {backups.length === 0 ? (
        <p className="text-xs text-faint">Henüz yedek yok.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {backups.map((b) => (
            <div
              key={b.path}
              className="flex items-center justify-between px-3 py-2"
            >
              <div>
                <div className="text-sm text-text">
                  {new Date(b.modifiedMs).toLocaleString("tr-TR")}
                </div>
                <div className="tnum text-xs text-faint">
                  {formatBytes(b.bytes)}
                </div>
              </div>
              <button
                onClick={() => setConfirmRestore(b)}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface hover:text-text"
              >
                Geri yükle
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
            className="w-96 rounded-lg border border-border bg-surface-2 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">Yedeği geri yükle?</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {new Date(confirmRestore.modifiedMs).toLocaleString("tr-TR")}{" "}
              tarihli yedek geri yüklenecek. Mevcut durumun da ayrıca yedeklenir.
              Uygulama yeniden başlar.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmRestore(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-text"
              >
                Vazgeç
              </button>
              <button
                onClick={() =>
                  invoke("restore_backup", { path: confirmRestore.path }).catch(
                    () => {}
                  )
                }
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
              >
                Geri yükle & yeniden başlat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AboutSettings() {
  return (
    <div className="max-w-2xl text-sm leading-relaxed text-muted">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-md bg-accent/15 text-xl font-semibold text-accent">
          ◈
        </div>
        <div>
          <div className="text-base font-semibold text-text">Resonance</div>
          <div className="text-xs text-faint">Sürüm 0.1.0</div>
        </div>
      </div>
      <p className="mt-4">
        Hafif, karma tabanlı kişisel müzik oynatıcı. Ses YouTube'dan (yt-dlp)
        gelir; Spotify / YouTube Music listeleri içe aktarılır.
      </p>
      <p className="mt-3 text-faint">
        Kişisel kullanım içindir. YouTube'dan ses çekmek YouTube Hizmet
        Şartları'na aykırı olabilir; bu uygulamayı kendi sorumluluğunda kullan.
      </p>
      <p className="mt-3 text-faint">
        Tauri · React · rodio · yt-dlp · ffmpeg ile yapıldı.
      </p>
    </div>
  );
}

export default function SettingsView() {
  const [active, setActive] = useState<CatId>("account");
  const current = categories.find((c) => c.id === active)!;

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Ayarlar" />
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
                {c.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto px-8 py-2">
          <h2 className="mb-4 text-lg font-semibold">{current.label}</h2>
          {active === "account" ? (
            <AccountSettings />
          ) : active === "playback" ? (
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
  );
}
