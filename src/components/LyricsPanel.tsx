import { memo, useState, useEffect, useRef } from "react";
import { X, Loader2, Music4, Minus, Plus } from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import { useT } from "../lib/i18n";
import { useAppStore } from "../store/useAppStore";
import {
  fetchLyrics,
  loadLyricsOffset,
  OFFSET_STEP_MS,
  saveLyricsOffset,
  VERSION_GAP_MS,
  type LrcLine,
} from "../lib/lyrics";

// Satır, söylenmeye başlamadan bu kadar önce "aktif" olur. Küçük bir öndelik
// doğru hissettiriyor; büyük olursa satır erken atlar.
const LEAD_MS = 120;

function findActive(lines: LrcLine[], posMs: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= posMs + LEAD_MS) idx = i;
    else break;
  }
  return idx;
}

/**
 * Çalma pozisyonunu tick'ler ARASINDA da ilerleten saat.
 *
 * ⚠️ NEDEN GEREKLİ: `positionMs` yalnız 250 ms'de bir güncelleniyor
 * (`playback-tick`). Karaoke dolgusu doğrudan ona bağlıydı → hem basamak
 * basamak ilerliyor hem de ORTALAMA 125 ms, en kötü hâlde 250 ms GERİDEN
 * geliyordu. Kullanıcının "efekt şarkıdan geride" dediği şey buydu.
 * Tick geldiğinde saat eşitlenir, aradaki süre yerel saatle doldurulur.
 */
function useSmoothPosition(): number {
  const positionMs = usePlayerStore((s) => s.positionMs);
  const playing = usePlayerStore((s) => s.status === "playing");
  const [smooth, setSmooth] = useState(positionMs);
  const anchor = useRef({ pos: positionMs, at: 0 });

  useEffect(() => {
    anchor.current = { pos: positionMs, at: performance.now() };
    setSmooth(positionMs);
  }, [positionMs]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      if (now - last < 33) return; // ~30 fps yeter, boşuna render etme
      last = now;
      const a = anchor.current;
      // Tick gecikirse ileri kaçmayalım: en fazla bir tick kadar tahmin.
      setSmooth(a.pos + Math.min(performance.now() - a.at, 400));
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return playing ? smooth : positionMs;
}

// ⭐ Tek söz satırı — MEMO'lu (v1.9.9). `useSmoothPosition` ~30 fps ile panel
// bileşenini yeniden çiziyordu ve yüzlerce satır her karede yeniden
// render ediliyordu. Satır yalnız kendi durumu (uzaklık sınıfı / aktiflik)
// değişince çizilir; ilerleme (progress) YALNIZ aktif satıra verilir, diğerleri
// sabit 0 alır → kare başına tek satır çizilir. Aktife geçen satır kendini
// ortaya kaydırır (eskiden panelde activeRef + efekt vardı).
const LyricRow = memo(function LyricRow({
  text,
  timeMs,
  state,
  active,
  progress,
  offsetMs,
  onSeek,
}: {
  text: string;
  timeMs: number;
  state: string;
  active: boolean;
  progress: number;
  offsetMs: number;
  onSeek: (ms: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);
  return (
    <div
      ref={ref}
      onClick={() => onSeek(Math.max(0, timeMs + offsetMs))}
      className={`origin-center cursor-pointer py-2.5 text-2xl font-semibold leading-snug transition-all duration-300 hover:text-text ${state}`}
    >
      {/* Aktif satırda ilerleme: sözün okunan kısmı vurgulanır. */}
      {active && text ? (
        <span className="relative inline-block">
          <span className="text-faint">{text}</span>
          <span
            className="absolute left-0 top-0 overflow-hidden whitespace-nowrap text-accent transition-[width] duration-200 ease-linear"
            style={{ width: `${Math.round(progress * 100)}%` }}
          >
            {text}
          </span>
        </span>
      ) : (
        text || "♪"
      )}
    </div>
  );
});

export default function LyricsPanel() {
  const t = useT();
  const current = usePlayerStore((s) => s.current);
  const rawPositionMs = useSmoothPosition();
  const seek = usePlayerStore((s) => s.seek);
  const toggleLyrics = useAppStore((s) => s.toggleLyrics);

  const [loading, setLoading] = useState(false);
  const [synced, setSynced] = useState<LrcLine[] | null>(null);
  const [plain, setPlain] = useState<string | null>(null);
  const [lyricsMs, setLyricsMs] = useState(0);
  // + = sözler GEÇ gelsin. Parça başına hatırlanır (lib/lyrics.ts).
  const [offsetMs, setOffsetMs] = useState(0);
  const positionMs = rawPositionMs - offsetMs;

  useEffect(() => {
    if (!current) {
      setSynced(null);
      setPlain(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSynced(null);
    setPlain(null);
    setLyricsMs(0);
    setOffsetMs(loadLyricsOffset(current.id));
    fetchLyrics(current.id, current.artist, current.title, current.durationMs)
      .then((r) => {
        if (cancelled) return;
        setSynced(r.synced);
        setPlain(r.plain);
        setLyricsMs(r.lyricsMs);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [current?.id]);

  const activeIdx = synced ? findActive(synced, positionMs) : -1;
  // Aktif satırın ne kadarı okundu (0..1). Bir sonraki satırın zaman damgası
  // satırın bitişini verir; son satırda parça sonuna kadar sayılır.
  const lineProgress = (() => {
    if (!synced || activeIdx < 0) return 0;
    const start = synced[activeIdx].timeMs;
    const end = synced[activeIdx + 1]?.timeMs ?? start + 4000;
    if (end <= start) return 1;
    return Math.max(0, Math.min(1, (positionMs - start) / (end - start)));
  })();

  const shiftOffset = (delta: number) => {
    if (!current) return;
    setOffsetMs(saveLyricsOffset(current.id, offsetMs + delta));
  };
  // Söz kaydı başka bir sürüme ait olabilir (klip girişi, canlı kayıt).
  const versionGap =
    synced && lyricsMs > 0 && current && current.durationMs > 0
      ? Math.abs(current.durationMs - lyricsMs) >= VERSION_GAP_MS
      : false;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-bg/95 backdrop-blur-sm animate-panel-in">
      <header className="flex items-start justify-between px-8 pb-3 pt-6">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">
            {current?.title ?? t("lyrics.title")}
          </h2>
          <p className="truncate text-sm text-muted">{current?.artist}</p>
          {versionGap && (
            <p className="mt-1 text-xs text-faint">{t("lyrics.versionGap")}</p>
          )}
        </div>
        {synced && (
          <div
            className="ml-auto mr-2 flex shrink-0 items-center gap-1 rounded-md bg-surface px-1 py-0.5 text-xs text-muted"
            title={t("lyrics.offsetHint")}
          >
            <button
              onClick={() => shiftOffset(-OFFSET_STEP_MS)}
              title={t("lyrics.earlier")}
              className="grid h-6 w-6 place-items-center rounded hover:bg-surface-2 hover:text-text"
            >
              <Minus size={13} />
            </button>
            <button
              onClick={() => shiftOffset(-offsetMs)}
              title={t("lyrics.resetOffset")}
              className="min-w-[3.5rem] rounded px-1 font-mono tabular-nums hover:text-text"
            >
              {t("lyrics.offsetValue", {
                v: `${offsetMs > 0 ? "+" : offsetMs < 0 ? "−" : "±"}${(Math.abs(offsetMs) / 1000).toFixed(1)}`,
              })}
            </button>
            <button
              onClick={() => shiftOffset(OFFSET_STEP_MS)}
              title={t("lyrics.later")}
              className="grid h-6 w-6 place-items-center rounded hover:bg-surface-2 hover:text-text"
            >
              <Plus size={13} />
            </button>
          </div>
        )}
        <button
          onClick={toggleLyrics}
          title={t("common.close")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface hover:text-text"
        >
          <X size={18} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-16 pt-6">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-24 text-faint">
            <Loader2 size={28} className="animate-spin text-accent" />
            <span className="text-sm">{t("lyrics.loading")}</span>
          </div>
        ) : synced ? (
          <div className="mx-auto max-w-2xl text-center">
            {synced.map((l, i) => {
              // ⭐ KARAOKE VURGUSU (v1.8.2): eskiden yalnız renk değişiyordu.
              // Uzaklığa göre solma + aktif satırın büyümesi, gözün satırı
              // takip etmesini kolaylaştırır (Apple Music/Spotify deseni).
              const d = Math.abs(i - activeIdx);
              const state =
                activeIdx < 0
                  ? "text-muted"
                  : d === 0
                  ? "scale-[1.04] text-text"
                  : d === 1
                  ? "text-muted"
                  : d === 2
                  ? "text-faint"
                  : "text-faint/50";
              return (
                <LyricRow
                  key={i}
                  text={l.text}
                  timeMs={l.timeMs}
                  state={state}
                  active={i === activeIdx}
                  progress={i === activeIdx ? lineProgress : 0}
                  offsetMs={offsetMs}
                  onSeek={seek}
                />
              );
            })}
          </div>
        ) : plain ? (
          <div className="mx-auto max-w-2xl whitespace-pre-wrap text-lg leading-relaxed text-muted">
            {plain}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-24 text-faint">
            <Music4 size={32} strokeWidth={1.5} />
            <p className="text-sm">
              {current
                ? t("lyrics.notFound")
                : t("lyrics.noTrack")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
