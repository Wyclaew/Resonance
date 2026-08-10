import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Sidebar from "./components/Sidebar";
import NowPlayingBar from "./components/NowPlayingBar";
import LyricsPanel from "./components/LyricsPanel";
import QueuePanel from "./components/QueuePanel";
import CommandPalette from "./components/CommandPalette";
import Screensaver from "./components/Screensaver";
import Onboarding from "./components/Onboarding";
import WindowControls from "./components/WindowControls";
import Toasts from "./components/Toasts";
import { getDb, isTauri } from "./lib/db";
import { onRemoteApplied, startSync } from "./lib/sync/engine";
import { pruneAudioCache } from "./lib/library";
import {
  initPlayer,
  usePlayerStore,
  prewarmDiscovery,
} from "./store/usePlayerStore";
import HomeView from "./views/HomeView";
import DiscoverView from "./views/DiscoverView";
import SearchView from "./views/SearchView";
import LibraryView from "./views/LibraryView";
import DownloadsView from "./views/DownloadsView";
import PlaylistView from "./views/PlaylistView";
import ImportView from "./views/ImportView";
import SettingsView from "./views/SettingsView";
import { useAppStore } from "./store/useAppStore";
import { useLibraryStore } from "./store/useLibraryStore";
import { usePlaylistStore } from "./store/usePlaylistStore";
import { useSettingsStore } from "./store/useSettingsStore";

function CurrentView() {
  const view = useAppStore((s) => s.view);
  const activePlaylistId = useAppStore((s) => s.activePlaylistId);

  switch (view) {
    case "now":
      return <HomeView />;
    case "discover":
      return <DiscoverView />;
    case "search":
      return <SearchView />;
    case "library":
      return <LibraryView />;
    case "downloads":
      return <DownloadsView />;
    case "playlist":
      return <PlaylistView playlistId={activePlaylistId} />;
    case "import":
      return <ImportView />;
    case "settings":
      return <SettingsView />;
    default:
      return <HomeView />;
  }
}

// Windows mı? (çerçevesiz pencerede sol boşluk/buton yerleşimi için)
const isWindows =
  typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

// Hex rengi verilen oranla koyulaştırır (açık tema kontrastı için).
function darken(hex: string, factor: number): string {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.max(0, Math.min(255, Math.round(c * factor)))
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export default function App() {
  const accentColor = useSettingsStore((s) => s.accentColor);
  const theme = useSettingsStore((s) => s.theme);
  const lyricsOpen = useAppStore((s) => s.lyricsOpen);
  const queueOpen = useAppStore((s) => s.queueOpen);
  const commandOpen = useAppStore((s) => s.commandOpen);
  const view = useAppStore((s) => s.view);
  const activePlaylistId = useAppStore((s) => s.activePlaylistId);
  const screensaverSeconds = useSettingsStore((s) => s.screensaverSeconds);
  const idle = useAppStore((s) => s.idle);
  const setIdle = useAppStore((s) => s.setIdle);
  const setBackgrounded = useAppStore((s) => s.setBackgrounded);

  // Ambiyans/ekran koruyucu: belirlenen süre etkileşim olmazsa devreye girer,
  // herhangi bir hareket/tuş/tıkla kapanır. 0 = kapalı. Pencere arka plandayken
  // (odak yok) tetiklenmez — ikinci ekranda dururken gereksiz animasyon çalmasın.
  useEffect(() => {
    if (!screensaverSeconds || screensaverSeconds <= 0) {
      setIdle(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!useAppStore.getState().backgrounded) setIdle(true);
      }, screensaverSeconds * 1000);
    };
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [screensaverSeconds]);

  // Arka plan FPS modu: pencere odağı kaybedince (ör. ikinci ekranda, üstte başka
  // uygulama) animasyon/geçişleri durdur ve tick sıklığını kıs → GPU/CPU tasarrufu.
  useEffect(() => {
    const onBlur = () => {
      setBackgrounded(true);
      document.documentElement.classList.add("bg-throttle");
    };
    const onFocus = () => {
      setBackgrounded(false);
      document.documentElement.classList.remove("bg-throttle");
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // DB'yi açılışta başlat (migration'ları tetikler). Tauri dışında atlanır.
  useEffect(() => {
    if (!isTauri()) return;
    getDb()
      .then(async () => {
        console.info("[resonance] veritabanı hazır");
        await Promise.all([
          useLibraryStore.getState().refresh(),
          usePlaylistStore.getState().refresh(),
        ]);
        useSettingsStore
          .getState()
          .load()
          .then(() => {
            const s = useSettingsStore.getState();
            if (s.rememberVolume) usePlayerStore.getState().setVolume(s.savedVolume);
            // Kaldığın yerden devam. mode:"discovery" → tüm Keşfet kuyruğu
            // (reroll atmadıkça değişmez); değilse tek şarkı (geriye dönük uyum).
            if (s.resumeState) {
              try {
                const r = JSON.parse(s.resumeState);
                if (r.mode === "discovery" && Array.isArray(r.queue) && r.queue.length) {
                  usePlayerStore.getState().restoreDiscovery({
                    queue: r.queue,
                    queueIndex: r.queueIndex ?? 0,
                    seedArtists: r.seedArtists ?? [],
                    filters: r.filters ?? [],
                    positionMs: r.positionMs || 0,
                  });
                } else if (r.track?.id) {
                  usePlayerStore.getState().restoreState(r.track, r.positionMs || 0);
                }
              } catch {
                /* bozuk resume state — yoksay */
              }
            }
            // Keşif önerilerini arka planda hazırla → Keşfet'e basınca anında başlasın.
            void prewarmDiscovery();
            // ⚠️ Önbellek budaması AYARLAR YÜKLENDİKTEN SONRA çalışmalı —
            // yukarıda çağrılırsa store hâlâ VARSAYILAN sınırı taşır ve
            // kullanıcının seçtiği (daha küçük) sınır hiç uygulanmaz.
            // İndirilenler korunur; yalnız geçici dosyalar en eskiden silinir.
            void pruneAudioCache();
          });
        // Veri varsa otomatik yedek al (kazara kayba karşı güvenlik ağı).
        const hasData =
          usePlaylistStore.getState().playlists.length > 0 ||
          useLibraryStore.getState().downloads.length > 0;
        if (hasData) invoke("backup_db").catch(() => {});
        // Bulut senkronu: yalnız yapılandırılmış VE oturum açıksa başlar
        // (aksi halde sessizce hiçbir şey yapmaz — uygulama %100 yerel).
        void startSync();
      })
      .catch((e) => console.error("[resonance] veritabanı hatası:", e));
    initPlayer();
  }, []);

  // Uzaktan (diğer cihazdan) veri geldiğinde listeleri tazele — kullanıcı
  // Ayarlar'a girip elle yenilemek zorunda kalmasın.
  useEffect(
    () =>
      onRemoteApplied(() => {
        void useLibraryStore.getState().refresh();
        void usePlaylistStore.getState().refresh();
      }),
    []
  );

  // Vurgu rengini uygula (Görünüm ayarı).
  //
  // AÇIK TEMADA KOYULAŞTIR: kullanıcının seçtiği kehribar (#e0a33c) beyaz
  // zeminde ~1.9:1 kontrast veriyor — okunmuyor. Inline style stylesheet'i
  // ezdiği için :root[data-theme="light"] içindeki --color-accent'e güvenilemez;
  // rengi burada koyulaştırıp yazıyoruz. Seçilen renk kimliğini korur (ton aynı),
  // yalnız parlaklık düşer.
  // DİKKAT: isLight'ı DOM'dan (data-theme) okuma — bu efekt aşağıdaki tema
  // efektinden ÖNCE çalışır, ilk render'da öznitelik daha yazılmamış olur
  // (açık temada vurgu koyulaşmadan kalırdı). Doğrudan ayardan hesapla.
  useEffect(() => {
    const isLight =
      theme === "light" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: light)").matches);
    document.documentElement.style.setProperty(
      "--color-accent",
      isLight ? darken(accentColor, 0.62) : accentColor
    );
  }, [accentColor, theme]);

  // Tema: koyu / açık / sistem. `data-theme` özniteliği index.css'teki
  // :root[data-theme="light"] token override'ını tetikler.
  // "system" seçiliyse OS tercihi CANLI izlenir (kullanıcı gece moduna
  // geçince uygulama da geçsin — yeniden başlatma gerekmesin).
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const effective = theme === "system" ? (mq.matches ? "light" : "dark") : theme;
      root.setAttribute("data-theme", effective);
    };
    apply();
    if (theme !== "system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  // Klavye kısayolları (input/textarea dışında).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Komut paleti (Cmd/Ctrl+K) — input içindeyken bile çalışır.
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        const a = useAppStore.getState();
        a.setCommand(!a.commandOpen);
        return;
      }
      // Yan paneli daralt/genişlet (Cmd/Ctrl+B).
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        useAppStore.getState().toggleSidebar();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      const p = usePlayerStore.getState();
      switch (e.code) {
        case "Space":
          e.preventDefault();
          p.toggle();
          break;
        case "ArrowRight":
          if (e.shiftKey) p.next();
          else p.seek(Math.min(p.durationMs, p.positionMs + 5000));
          break;
        case "ArrowLeft":
          if (e.shiftKey) p.prev();
          else p.seek(Math.max(0, p.positionMs - 5000));
          break;
        case "ArrowUp":
          e.preventDefault();
          p.setVolume(Math.min(1, p.volume + 0.05));
          break;
        case "ArrowDown":
          e.preventDefault();
          p.setVolume(Math.max(0, p.volume - 0.05));
          break;
        case "KeyM":
          p.toggleMute();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
      {/* SÜRÜKLEME ŞERİDİ — başlık çubuğu gizli, pencere yalnız buradan taşınır.
          macOS: trafik ışıkları sol tarafta yüzer → sol 5rem boşluk (aşağıdaki
          paddingLeft) ışıklara tıklama buraya düşmesin diye. Windows: solda boşluk
          yok, SAĞDA kendi min/maks/kapat butonlarımız (WindowControls). */}
      <div
        data-tauri-drag-region
        className="flex h-7 w-full shrink-0 items-stretch justify-end bg-bg"
        style={{ paddingLeft: isWindows ? 0 : "5rem" }}
      >
        <WindowControls />
      </div>
      {/* AMBİYANS = ANA İÇERİĞİ UNMOUNT ET (liste/sidebar/playbar).
          ⚠️ ÖLÇÜLDÜ: bu RAM'i DÜŞÜRMEZ — WebKit heap high-water mark tutar,
          DOM serbest bıraksan da RSS'i OS'a geri vermez (debug'da 122MB sabit).
          FAYDASI CPU/PİL: ambiyanstayken playback-tick (250ms) tüm UI'yı değil
          yalnız küçük Screensaver'ı yeniden render eder → arka planda oyun
          oynarken (kullanıcının senaryosu) render yükü ciddi düşer.
          Çalma Rust thread'inde sürdüğü için playbar sökülse de ses durmaz;
          durum zustand'da olduğundan geri gelince kayıp olmaz. */}
      {!idle && (
        <>
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="relative min-w-0 flex-1 overflow-hidden bg-bg">
              {/* view (ve aktif liste) değişince yumuşak fade-in */}
              <div
                key={`${view}:${activePlaylistId ?? ""}`}
                className="h-full animate-fade-in"
              >
                <CurrentView />
              </div>
              {lyricsOpen && <LyricsPanel />}
              {queueOpen && <QueuePanel />}
            </main>
          </div>
          <NowPlayingBar />
        </>
      )}
      {commandOpen && <CommandPalette />}
      {idle && <Screensaver />}
      <Onboarding />
      <Toasts />
    </div>
  );
}
