import { useCallback, useEffect, useRef, useState } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  Music2,
  ThumbsUp,
  ThumbsDown,
  Volume2,
  VolumeX,
  Loader2,
  Pin,
  PinOff,
  ChevronDown,
  ChevronUp,
  AppWindow,
} from "lucide-react";
import { formatMs } from "../lib/format";
import { useT, type Lang, type TrKey } from "../lib/i18n";
import { useSettingsStore } from "../store/useSettingsStore";
import {
  MINI_SIZES,
  type MiniCommand,
  type MiniState,
} from "../lib/miniPlayer";

// ═══════════════════════════════════════════════════════════════════════════
// MİNİ OYNATICI — küçük, hep üstte duran ikinci pencere.
//
// ⚠️ AYRI JS BAĞLAMI: bu pencere ana penceredeki zustand store'u, veritabanını
// ve ayarları GÖREMEZ. Durumu Rust'tan gelen `playback-tick` ile ana pencereden
// gelen `mini-state` olaylarından öğrenir; eylemleri de `mini-command` ile ANA
// pencereye yollar — kuyruk mantığı, oy kaydı ve öneri besleme orada yaşıyor ve
// ikiye bölünmemeli (bkz. src/lib/miniPlayer.ts).
//
// ⚠️ TEMA/DİL de oradan gelir: mini ayarları yüklemediği için kendi başına
// hep koyu temada ve varsayılan dilde kalırdı.
// ═══════════════════════════════════════════════════════════════════════════

const send = (cmd: MiniCommand) => void emit("mini-command", cmd);

// Klavye odağını elden geldiğince al (pencere + belge).
//
// ⚠️ ÖLÇÜLDÜ (macOS 15): çerçevesiz + hep-üstte mini pencere klavye olaylarını
// webview'e HİÇ geçirmiyor — `setFocus`, kök öğeye `tabIndex`/`focus()` ve
// `accept_first_mouse`'u KAPATMAK bile değiştirmedi (üçü de tek tek denendi).
// Yani aşağıdaki kısayollar macOS'ta ÇALIŞMIYOR; Windows'ta muhtemelen çalışır
// ama SINANMADI. Fare kontrollerinin hepsi çalışıyor; kısayollar bonustur.
const takeFocus = () => {
  getCurrentWindow()
    .setFocus()
    .catch(() => {});
  // Pencere odağı yetmiyor: WebKit'te klavye olayları ancak belge içinde
  // odaklanmış bir öğe varsa akıyor. Kök kabı odaklanabilir yapıp (tabIndex)
  // odağı ona veriyoruz.
  document.getElementById("mini-root")?.focus();
};

export default function MiniPlayer() {
  const t = useT();
  const [st, setSt] = useState<MiniState | null>(null);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Pencere Rust tarafında KAYITLI boyla kurulur; hangi modda açıldığımızı
  // yüksekliğinden anlıyoruz (ayrı bir bayrak taşımaya gerek yok).
  const [compact, setCompact] = useState(
    () => window.innerHeight < (MINI_SIZES.compact.h + MINI_SIZES.full.h) / 2
  );
  const [pinned, setPinned] = useState(true);
  // Sürükleme sırasında tick'in kolu geri çekmesini engelleyen yerel değerler.
  const [seekMs, setSeekMs] = useState<number | null>(null);
  const [volDrag, setVolDrag] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // ── Ana pencereden gelen durum ────────────────────────────────────────────
  useEffect(() => {
    const subs: Array<Promise<() => void>> = [];
    subs.push(
      listen<{ position_ms: number; duration_ms: number; playing: boolean }>(
        "playback-tick",
        (e) => {
          setPos(e.payload.position_ms);
          if (e.payload.duration_ms > 0) setDur(e.payload.duration_ms);
          setPlaying(e.payload.playing);
        }
      )
    );
    subs.push(
      listen<MiniState>("mini-state", (e) => {
        setSt(e.payload);
        // Dil: `useT` ayar store'unu dinliyor → burada set etmek yeter.
        useSettingsStore.setState({ language: e.payload.lang as Lang });
        const root = document.documentElement;
        if (e.payload.theme === "light") root.setAttribute("data-theme", "light");
        else root.removeAttribute("data-theme");
        if (e.payload.accent)
          root.style.setProperty("--color-accent", e.payload.accent);
        // Şarkı değiştiyse süre bilgisi tick gelene kadar eskimesin.
        if (!e.payload.title) {
          setDur(0);
          setPos(0);
        }
      })
    );
    // Açılışta mevcut durumu iste (pencere sonradan açıldı, olayları kaçırdı).
    send({ action: "sync" });
    takeFocus(); // (macOS'ta klavyeyi açmıyor — yukarıdaki nota bak)
    return () => subs.forEach((p) => void p.then((f) => f()));
  }, []);

  // ── Pencere: boy değişimi + konumun hatırlanması ──────────────────────────
  const applySize = useCallback(async (next: boolean) => {
    const size = next ? MINI_SIZES.compact : MINI_SIZES.full;
    const win = getCurrentWindow();
    try {
      await win.setSize(new LogicalSize(size.w, size.h));
      // Boy tercihi de konumla birlikte saklanır: bir sonraki açılış aynı
      // modda gelsin (pencere Rust tarafında bu ölçüyle kurulur).
      const [p, sf] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
      send({
        action: "geometry",
        x: Math.round(p.x / sf),
        y: Math.round(p.y / sf),
        compact: next,
      });
    } catch {
      /* izin yoksa boyut değişmez; mini yine de çalışır */
    }
  }, []);

  // Taşınınca konumu ana pencereye bildir (o kaydeder) — bir sonraki açılış
  // aynı yerde olsun. Sürükleme boyunca akan olayları seyrekleştiriyoruz.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const un = getCurrentWindow().onMoved(({ payload }) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void getCurrentWindow()
          .scaleFactor()
          .then((sf) =>
            send({
              action: "geometry",
              x: Math.round(payload.x / sf),
              y: Math.round(payload.y / sf),
              compact,
            })
          )
          .catch(() => {});
      }, 400);
    });
    return () => {
      clearTimeout(timer);
      void un.then((f) => f());
    };
  }, [compact]);

  // ── Klavye (BONUS, macOS'ta çalışmıyor — `takeFocus` notuna bak) ─────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Odak bir düğme/kaydıraçtaysa Space ve oklar zaten o öğeyi sürüyor —
      // ikinci kez burada işlersek eylem ÇİFT çalışır (ses iki kat artar,
      // oynat-duraklat kendi kendini iptal eder).
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "BUTTON" || tag === "TEXTAREA") return;
      const d = dur || 1;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          setPlaying((p) => !p);
          send({ action: "toggle" });
          break;
        case "ArrowRight":
          send({ action: "seek", ms: Math.min(d, pos + 5000) });
          break;
        case "ArrowLeft":
          send({ action: "seek", ms: Math.max(0, pos - 5000) });
          break;
        case "ArrowUp":
          send({ action: "volume", value: Math.min(1, (st?.volume ?? 1) + 0.05) });
          break;
        case "ArrowDown":
          send({ action: "volume", value: Math.max(0, (st?.volume ?? 0) - 0.05) });
          break;
        case "KeyN":
          send({ action: "next" });
          break;
        case "KeyP":
          send({ action: "prev" });
          break;
        case "KeyM":
          send({ action: "mute" });
          break;
        case "Escape":
          void getCurrentWindow().close();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pos, dur, st?.volume]);

  // ── İlerleme çubuğu: tıkla + sürükle ──────────────────────────────────────
  const ratioFromEvent = (clientX: number): number => {
    const el = barRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
  };
  const onBarDown = (e: React.PointerEvent) => {
    if (dur <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setSeekMs(ratioFromEvent(e.clientX) * dur);
  };
  const onBarMove = (e: React.PointerEvent) => {
    if (seekMs === null || dur <= 0) return;
    setSeekMs(ratioFromEvent(e.clientX) * dur);
  };
  const onBarUp = () => {
    if (seekMs === null) return;
    send({ action: "seek", ms: Math.round(seekMs) });
    setPos(seekMs); // tick gelene kadar kol geri sıçramasın
    setSeekMs(null);
  };

  const shownPos = seekMs ?? pos;
  const pct = dur > 0 ? Math.min(100, (shownPos / dur) * 100) : 0;
  const loading = st?.status === "loading";
  const vol = volDrag ?? st?.volume ?? 1;
  const muted = st?.muted ?? false;
  const hasTrack = Boolean(st?.title);

  const iconBtn =
    "grid h-6 w-6 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40";

  return (
    <div
      id="mini-root"
      tabIndex={-1}
      data-tauri-drag-region
      onPointerDown={takeFocus}
      className="relative flex h-screen w-screen select-none flex-col overflow-hidden bg-surface text-text outline-none"
    >
      {/* Kapak arka planı — pencere küçük olduğu için çok hafif. */}
      {st?.thumbnail && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 scale-125 bg-cover bg-center opacity-[0.16] blur-xl"
          style={{ backgroundImage: `url(${st.thumbnail})` }}
        />
      )}

      <div
        data-tauri-drag-region
        className="relative flex flex-1 flex-col justify-between px-3 py-2"
      >
        {/* ── Üst satır: kapak + başlık + pencere düğmeleri ── */}
        <div className="flex items-center gap-2.5" data-tauri-drag-region>
          <div
            className={`grid shrink-0 place-items-center overflow-hidden rounded bg-surface-2 text-faint ${
              compact ? "h-8 w-8" : "h-11 w-11"
            }`}
          >
            {st?.thumbnail ? (
              <img src={st.thumbnail} alt="" className="h-full w-full object-cover" />
            ) : (
              <Music2 size={compact ? 14 : 18} />
            )}
          </div>

          <div className="min-w-0 flex-1" data-tauri-drag-region>
            <div className="flex items-center gap-1.5">
              {loading && (
                <Loader2 size={11} className="shrink-0 animate-spin text-accent" />
              )}
              <div className="truncate text-xs font-medium" data-tauri-drag-region>
                {st?.title || t("mini.nothing")}
              </div>
            </div>
            <div className="truncate text-[11px] text-muted" data-tauri-drag-region>
              {st?.error ? (
                <span className="text-red-400">{st.error}</span>
              ) : (
                st?.artist || ""
              )}
            </div>
          </div>

          {compact && (
            <MiniTransport
              compact
              playing={playing}
              onToggle={() => {
                setPlaying((p) => !p);
                send({ action: "toggle" });
              }}
              onPrev={() => send({ action: "prev" })}
              onNext={() => send({ action: "next" })}
              t={t}
            />
          )}

          <div className="flex shrink-0 items-center">
            <button
              className={iconBtn}
              title={compact ? t("mini.expand") : t("mini.collapse")}
              onClick={() => {
                const next = !compact;
                setCompact(next);
                void applySize(next);
              }}
            >
              {compact ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            <button
              className={iconBtn}
              title={pinned ? t("mini.unpin") : t("mini.pin")}
              onClick={() => {
                const next = !pinned;
                setPinned(next);
                getCurrentWindow()
                  .setAlwaysOnTop(next)
                  .catch(() => {});
              }}
            >
              {pinned ? <Pin size={12} /> : <PinOff size={12} />}
            </button>
            <button
              className={iconBtn}
              title={t("mini.mainWindow")}
              onClick={() => send({ action: "showMain" })}
            >
              <AppWindow size={12} />
            </button>
            <button
              className={iconBtn}
              title={t("common.close")}
              onClick={() => void getCurrentWindow().close()}
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* ── İlerleme çubuğu (iki modda da var) ── */}
        <div
          ref={barRef}
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onPointerCancel={onBarUp}
          className={`group relative ${
            compact ? "mt-1.5" : "mt-2"
          } cursor-pointer py-1.5`}
          title={dur > 0 ? formatMs(shownPos) : undefined}
        >
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-100"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div
            className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent opacity-0 transition-opacity group-hover:opacity-100"
            style={{ left: `${pct}%` }}
          />
        </div>

        {/* ── Alt satır (yalnız genişletilmiş modda) ── */}
        {!compact && (
          <>
            <div className="flex items-center justify-between">
              <span className="w-9 text-[10px] tabular-nums text-faint">
                {formatMs(shownPos)}
              </span>

              <div className="flex items-center gap-0.5">
                <button
                  className={`${iconBtn} h-7 w-7`}
                  title={t("mini.dislike")}
                  disabled={!st?.canVote}
                  onClick={() => send({ action: "vote", dir: -1 })}
                >
                  <ThumbsDown size={13} />
                </button>
                <MiniTransport
                  playing={playing}
                  onToggle={() => {
                    setPlaying((p) => !p);
                    send({ action: "toggle" });
                  }}
                  onPrev={() => send({ action: "prev" })}
                  onNext={() => send({ action: "next" })}
                  t={t}
                />
                <button
                  className={`${iconBtn} h-7 w-7`}
                  title={t("mini.like")}
                  disabled={!st?.canVote}
                  onClick={() => send({ action: "vote", dir: 1 })}
                >
                  <ThumbsUp size={13} />
                </button>
              </div>

              <span className="w-9 text-right text-[10px] tabular-nums text-faint">
                {dur > 0 ? formatMs(dur) : "--:--"}
              </span>
            </div>

            {/* ── Sıradaki + ses ── */}
            <div className="mt-1 flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-[10px] text-faint">
                {hasTrack && (
                  <>
                    <span className="text-muted">
                      {st?.nextTitle ? `${t("mini.upNext")}: ` : ""}
                    </span>
                    {st?.nextTitle
                      ? `${st.nextTitle}${st.nextArtist ? ` — ${st.nextArtist}` : ""}`
                      : t("mini.queueEnd")}
                  </>
                )}
              </div>
              <button
                className={`${iconBtn} h-5 w-5`}
                title={muted ? t("player.unmute") : t("player.mute")}
                onClick={() => send({ action: "mute" })}
              >
                {muted || vol === 0 ? <VolumeX size={12} /> : <Volume2 size={12} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : vol}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolDrag(v);
                  send({ action: "volume", value: v });
                }}
                onPointerUp={() => setVolDrag(null)}
                style={{ accentColor: "var(--color-accent)" }}
                className="h-1 w-16 cursor-pointer"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Geri / oynat-duraklat / ileri — kompakt ve normal modda ortak. */
function MiniTransport({
  playing,
  compact,
  onToggle,
  onPrev,
  onNext,
  t,
}: {
  playing: boolean;
  compact?: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  t: (k: TrKey) => string;
}) {
  const s = compact ? 12 : 14;
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={onPrev}
        title={t("player.previous")}
        className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:text-text"
      >
        <SkipBack size={s} fill="currentColor" />
      </button>
      <button
        onClick={onToggle}
        title={playing ? t("player.pause") : t("player.play")}
        className={`grid place-items-center rounded-full bg-text text-bg transition-transform active:scale-95 ${
          compact ? "h-7 w-7" : "h-8 w-8"
        }`}
      >
        {playing ? (
          <Pause size={s} fill="currentColor" />
        ) : (
          <Play size={s} fill="currentColor" className="ml-0.5" />
        )}
      </button>
      <button
        onClick={onNext}
        title={t("player.next")}
        className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:text-text"
      >
        <SkipForward size={s} fill="currentColor" />
      </button>
    </div>
  );
}
