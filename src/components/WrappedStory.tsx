import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "../lib/i18n";
import { EMPTY_WRAPPED, loadWrapped, type WrappedData } from "../lib/wrapped";
import { useToastStore } from "../store/useToastStore";
import Logo from "./Logo";

// ═══════════════════════════════════════════════════════════════════════════
// YILLIK ÖZET — HİKÂYE (v1.9.6)
//
// Kullanıcının isteği: "Spotify gibi olsun ve sürekli görünmesin; yıl sonunda
// Instagram hikâyesi gibi çıksın." Sayfa hâli (`WrappedView`) duruyor —
// ayrıntıya bakmak isteyen oraya girer; bu bileşen o verinin BÜYÜK, tek tek
// ilerleyen ve ekran görüntüsü alınmaya uygun sunumu.
//
// Kendi kendine ilerler (6 sn), tıklayınca/oklarla elle gezilir, Esc kapatır.
// ⚠️ Görsel dosya ÜRETMİYORUZ (canvas'a çizmek her tema/dil için ayrı bakım) —
// kart ekran görüntüsü alınacak biçimde tasarlandı.
// ═══════════════════════════════════════════════════════════════════════════

const SLIDE_MS = 6000;

interface Slide {
  kicker: string;
  big: string;
  sub?: string;
  list?: { name: string; extra: string }[];
}

export default function WrappedStory({
  year,
  onClose,
}: {
  year: number;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToastStore((s) => s.show);
  const [d, setD] = useState<WrappedData>(EMPTY_WRAPPED);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    void loadWrapped(year).then(setD);
  }, [year]);

  const slides: Slide[] = useMemo(() => {
    const minutes = Math.round(d.totalMs / 60000);
    const hours = Math.round(minutes / 60);
    const out: Slide[] = [
      {
        kicker: t("wrapped.storyIntro", { year }),
        big: t("wrapped.storyMinutes", { minutes }),
        sub: t("wrapped.storyHours", { hours, plays: d.plays }),
      },
      {
        kicker: t("wrapped.storyArtistsKicker"),
        big: String(d.artists),
        sub: t("wrapped.storyArtistsSub", { newArtists: d.newArtists }),
        list: d.topArtists.slice(0, 5).map((a) => ({
          name: a.name,
          extra: t("wrapped.storyPlays", { n: a.plays }),
        })),
      },
      {
        kicker: t("wrapped.storyTracksKicker"),
        big: d.topTracks[0]?.name ?? "—",
        sub: d.topTracks[0]
          ? t("wrapped.storyPlays", { n: d.topTracks[0].plays })
          : undefined,
        list: d.topTracks.slice(1, 5).map((x) => ({
          name: x.name,
          extra: t("wrapped.storyPlays", { n: x.plays }),
        })),
      },
      {
        kicker: t("wrapped.storyHabitKicker"),
        big: t("wrapped.storyPeakHour", { hour: d.peakHour }),
        sub: t("wrapped.storyStreak", { n: d.longestStreak }),
      },
      {
        kicker: t("wrapped.storyRecKicker"),
        big: String(d.recommended),
        sub: t("wrapped.storyRecSub", {
          accepted: d.recAccepted,
          genres: d.newGenres,
        }),
      },
    ];
    return out;
  }, [d, t, year]);

  // Otomatik ilerleme (duraklatılabilir).
  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const id = setTimeout(() => {
      setI((v) => (v + 1 < slides.length ? v + 1 : v));
    }, SLIDE_MS);
    return () => clearTimeout(id);
  }, [i, paused, slides.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((v) => Math.min(v + 1, slides.length - 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(v - 1, 0));
      if (e.key === " ") setPaused((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, slides.length]);

  const copy = async () => {
    const minutes = Math.round(d.totalMs / 60000);
    const lines = [
      `Resonance ${year}`,
      t("wrapped.copyMinutes", { minutes, plays: d.plays }),
      t("wrapped.copyArtists", { artists: d.artists, newArtists: d.newArtists }),
      d.topArtists.length
        ? t("wrapped.copyTop", { list: d.topArtists.map((a) => a.name).join(", ") })
        : "",
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast(t("wrapped.copied"), "success");
    } catch {
      toast(t("wrapped.copyFailed"), "error");
    }
  };

  const s = slides[i];

  // ⚠️ PORTAL ŞART: bileşen `main` (relative + animate-fade-in) içinde
  // çiziliyordu ve `position: fixed` orada TAM EKRAN OLMUYOR (animasyondaki
  // transform içeren ata, fixed için kapsayıcı blok olur) → hikâye kenar
  // çubuğunun ve alt barın üstünü örtmüyordu.
  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-bg/98 backdrop-blur-xl">
      {/* İlerleme çubukları — hikâye dili */}
      <div className="flex gap-1.5 px-4 pt-4">
        {slides.map((_, idx) => (
          <div key={idx} className="h-[3px] flex-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full bg-accent transition-[width] duration-200"
              style={{ width: idx < i ? "100%" : idx === i ? "100%" : "0%" }}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2 text-sm text-muted">
          <Logo className="h-4 w-4 text-accent" /> Resonance · {year}
        </span>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-text"
          aria-label={t("common.close")}
        >
          <X size={18} />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-10 pb-16"
        onClick={() => setI((v) => (v + 1 < slides.length ? v + 1 : v))}
        onMouseDown={() => setPaused(true)}
        onMouseUp={() => setPaused(false)}
      >
        <div key={i} className="animate-fade-in w-full max-w-xl text-center">
          <div className="text-sm uppercase tracking-[0.2em] text-accent">{s.kicker}</div>
          <div className="font-display mt-4 break-words text-5xl font-semibold leading-tight">
            {s.big}
          </div>
          {s.sub && <div className="mt-4 text-base text-muted">{s.sub}</div>}
          {s.list && s.list.length > 0 && (
            <div className="mx-auto mt-8 w-full max-w-sm space-y-1.5 text-left">
              {s.list.map((row, idx) => (
                <div
                  key={`${row.name}-${idx}`}
                  className="flex items-center gap-3 rounded-lg bg-surface/70 px-3 py-2"
                >
                  <span className="tnum w-5 text-right text-xs text-faint">{idx + 2}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                  <span className="shrink-0 text-xs text-muted">{row.extra}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Elle gezinme */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setI((v) => Math.max(v - 1, 0));
          }}
          disabled={i === 0}
          className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-muted hover:bg-surface hover:text-text disabled:opacity-0"
        >
          <ChevronLeft size={22} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setI((v) => Math.min(v + 1, slides.length - 1));
          }}
          disabled={i === slides.length - 1}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-muted hover:bg-surface hover:text-text disabled:opacity-0"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      <div className="flex items-center justify-center gap-2 pb-8">
        <button
          onClick={() => void copy()}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg"
        >
          {t("wrapped.copy")}
        </button>
        <button
          onClick={onClose}
          className="rounded-full bg-surface-2 px-4 py-2 text-sm text-text"
        >
          {t("common.close")}
        </button>
      </div>
    </div>,
    document.body
  );
}
