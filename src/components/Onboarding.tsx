import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  Sparkles,
  ThumbsUp,
  Link2,
  Search,
  Brain,
  SlidersHorizontal,
} from "lucide-react";
import { useSettingsStore } from "../store/useSettingsStore";
import { useAppStore } from "../store/useAppStore";
import { useT, type TrKey } from "../lib/i18n";
import type { ViewId } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// İLK AÇILIŞ TURU — uygulamayı GEZDİREREK anlatır.
//
// ⚠️ ESKİ HÂLİ: ortada duran 6 sayfalık metin modalı. Kullanıcının geri
// bildirimi: "sadece yazı olarak kalması çok sıkıcı oluyor, uygulama içinde
// gezip göstererek bir tur yapsa daha iyi olur."
//
// YENİ DAVRANIŞ: her adım (a) ilgili SAYFAYA gider, (b) ilgili düğmeyi
// spotlight ile aydınlatır, (c) balonu o düğmenin yanına koyar.
//
// Hedefler `data-tour="..."` ile işaretlidir (Sidebar, ProfileMenu,
// NowPlayingBar, DiscoverView). Hedef bulunamazsa adım ORTADA normal kart
// olarak gösterilir — tur asla kırılmaz, yalnız vurgusunu kaybeder.
// ═══════════════════════════════════════════════════════════════════════════

type Step = {
  icon: typeof Sparkles;
  title: TrKey;
  body: TrKey;
  /** Bu adımda gidilecek sayfa. */
  view?: ViewId;
  /** Aydınlatılacak öğe: [data-tour="..."]. */
  target?: string;
};

const STEPS: Step[] = [
  { icon: Sparkles, title: "onb.welcomeTitle", body: "onb.welcomeBody", view: "now" },
  {
    icon: Sparkles,
    title: "onb.discoverTitle",
    body: "onb.discoverBody",
    view: "discover",
    target: "nav-discover",
  },
  {
    icon: SlidersHorizontal,
    title: "onb.filtersTitle",
    body: "onb.filtersBody",
    view: "discover",
    target: "filters",
  },
  { icon: ThumbsUp, title: "onb.karmaTitle", body: "onb.karmaBody", target: "vote" },
  {
    icon: Search,
    title: "onb.searchTitle",
    body: "onb.searchBody",
    view: "search",
    target: "nav-search",
  },
  {
    icon: Link2,
    title: "onb.importTitle",
    body: "onb.importBody",
    view: "import",
    target: "nav-import",
  },
  {
    icon: Brain,
    title: "onb.tasteTitle",
    body: "onb.tasteBody",
    target: "profile",
  },
];

type Rect = { top: number; left: number; width: number; height: number };

export default function Onboarding() {
  const t = useT();
  const ready = useSettingsStore((s) => s.ready);
  const done = useSettingsStore((s) => s.onboardingDone);
  const update = useSettingsStore((s) => s.update);
  const navigate = useAppStore((s) => s.navigate);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const active = ready && !done;
  const step = STEPS[i];

  // Adım değişince ilgili sayfaya git (turun "gezdirme" kısmı).
  useEffect(() => {
    if (!active) return;
    if (step.view) navigate(step.view);
  }, [active, i, step.view, navigate]);

  // Hedefi ölç. Sayfa geçişi + animasyon bittikten sonra ölçmek gerekiyor,
  // yoksa öğe henüz DOM'da olmaz ya da yanlış konumda ölçülür.
  const measure = useCallback(() => {
    if (!active || !step.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(
      `[data-tour="${step.target}"]`
    );
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      setRect(null);
      return;
    }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [active, step.target]);

  useLayoutEffect(() => {
    if (!active) return;
    measure();
    // Görünüm değişimi/animasyon için birkaç kez yeniden ölç.
    const timers = [80, 250, 600].map((ms) => setTimeout(measure, ms));
    window.addEventListener("resize", measure);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("resize", measure);
    };
  }, [active, i, measure]);

  if (!active) return null;

  const Icon = step.icon;
  const last = i === STEPS.length - 1;
  const finish = () => update("onboardingDone", true);

  // Balon konumu: hedefin sağında; sağa sığmazsa altında; hedef yoksa ortada.
  const PAD = 8;
  const CARD_W = 360;
  let cardStyle: React.CSSProperties = {};
  if (rect) {
    const spaceRight = window.innerWidth - (rect.left + rect.width);
    if (spaceRight > CARD_W + 32) {
      cardStyle = {
        top: Math.min(
          Math.max(12, rect.top - 8),
          window.innerHeight - 260
        ),
        left: rect.left + rect.width + 16,
      };
    } else {
      cardStyle = {
        top: Math.min(rect.top + rect.height + 16, window.innerHeight - 260),
        left: Math.max(12, Math.min(rect.left, window.innerWidth - CARD_W - 12)),
      };
    }
  }

  return (
    <div className="fixed inset-0 z-[70]">
      {/* Karartma: hedef varsa devasa box-shadow ile "delik" açılır. */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-accent transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.66)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      )}

      <div
        className={`absolute w-[22.5rem] max-w-[92vw] animate-pop-in rounded-xl border border-border bg-surface-2 p-5 shadow-2xl ${
          rect ? "" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        }`}
        style={rect ? cardStyle : undefined}
      >
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
            <Icon size={20} />
          </div>
          <h2 className="text-base font-semibold text-text">{t(step.title)}</h2>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-muted">{t(step.body)}</p>

        <div className="mt-5 flex items-center gap-1.5">
          {STEPS.map((_, n) => (
            <span
              key={n}
              className={`h-1.5 rounded-full transition-all ${
                n === i ? "w-5 bg-accent" : "w-1.5 bg-surface-3"
              }`}
            />
          ))}
          <span className="ml-auto text-xs tabular-nums text-faint">
            {t("onb.step", { n: i + 1, total: STEPS.length })}
          </span>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            onClick={finish}
            className="text-xs text-faint transition-colors hover:text-muted"
          >
            {t("onb.skip")}
          </button>
          <div className="flex items-center gap-2">
            {i > 0 && (
              <button
                onClick={() => setI((v) => v - 1)}
                className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
              >
                {t("onb.back")}
              </button>
            )}
            <button
              onClick={() => (last ? finish() : setI((v) => v + 1))}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
            >
              {last ? t("onb.finish") : t("onb.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
