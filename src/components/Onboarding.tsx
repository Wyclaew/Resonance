import { useState } from "react";
import { Sparkles, ThumbsUp, Link2, HardDriveDownload, Keyboard } from "lucide-react";
import { useSettingsStore } from "../store/useSettingsStore";
import { useT, type TrKey } from "../lib/i18n";

// İlk açılış rehberi — "neyin nerede olduğu" belli olsun.
// Ayarlar'daki `onboardingDone` bayrağıyla bir kez gösterilir; atlanabilir.
// Bilerek sade: modal + 6 adım, uygulamayı bloklamaz (Atla her adımda açık).

const STEPS: { icon: typeof Sparkles; title: TrKey; body: TrKey }[] = [
  { icon: Sparkles, title: "onb.welcomeTitle", body: "onb.welcomeBody" },
  { icon: Sparkles, title: "onb.discoverTitle", body: "onb.discoverBody" },
  { icon: ThumbsUp, title: "onb.karmaTitle", body: "onb.karmaBody" },
  { icon: Link2, title: "onb.importTitle", body: "onb.importBody" },
  { icon: HardDriveDownload, title: "onb.downloadTitle", body: "onb.downloadBody" },
  { icon: Keyboard, title: "onb.shortcutsTitle", body: "onb.shortcutsBody" },
];

export default function Onboarding() {
  const t = useT();
  const ready = useSettingsStore((s) => s.ready);
  const done = useSettingsStore((s) => s.onboardingDone);
  const update = useSettingsStore((s) => s.update);
  const [i, setI] = useState(0);

  // Ayarlar DB'den yüklenmeden gösterme — yoksa her açılışta bir an parlar.
  if (!ready || done) return null;

  const step = STEPS[i];
  const Icon = step.icon;
  const last = i === STEPS.length - 1;
  const finish = () => update("onboardingDone", true);

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 backdrop-blur-sm">
      <div className="w-[30rem] max-w-[92%] animate-pop-in rounded-xl border border-border bg-surface-2 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
            <Icon size={22} />
          </div>
          <h2 className="text-lg font-semibold text-text">{t(step.title)}</h2>
        </div>

        <p className="mt-4 min-h-[5.5rem] text-sm leading-relaxed text-muted">
          {t(step.body)}
        </p>

        {/* Adım göstergesi */}
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

        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={finish}
            className="rounded-md px-3 py-1.5 text-sm text-faint hover:bg-surface hover:text-text"
          >
            {t("onb.skip")}
          </button>
          <div className="flex gap-2">
            {i > 0 && (
              <button
                onClick={() => setI(i - 1)}
                className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-text"
              >
                {t("onb.back")}
              </button>
            )}
            <button
              onClick={() => (last ? finish() : setI(i + 1))}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-bg hover:opacity-90"
            >
              {last ? t("onb.done") : t("onb.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
