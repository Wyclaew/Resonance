import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Download, Loader2, Sparkles } from "lucide-react";
import { useT } from "../lib/i18n";
import Logo from "./Logo";

export interface UpdateInfo {
  version: string;
  current: string;
  notes?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// GÜNCELLEME PENCERESİ (v1.9.8)
//
// Eskiden yeni sürüm köşede 20 sn'lik küçük bir toast'tı — kullanıcı "çok
// küçük, gören güncellesin kesin" dedi. Artık ekranın ortasında; ilerleme
// çubuğuyla kurulur. "Güncellemeden devam et" yalnız BU OTURUM için kapatır:
// güncel olunmadıkça HER AÇILIŞTA yeniden gösterilir (kullanıcının isteği).
// ═══════════════════════════════════════════════════════════════════════════

/** Sürüm notundan (GitHub release gövdesi) yalnız okunur satırlar. */
function noteLines(notes?: string | null): string[] {
  if (!notes) return [];
  // Sürüm notları "---" ile kurulum metninden ayrılır (release.yml); o
  // genel metin ("sağ tık → Aç" vb.) güncelleyen kullanıcıya bir şey söylemez.
  const own = notes.split(/\n-{3,}\s*\n/)[0];
  if (/^\s*Otomatik sürüm/.test(own)) return [];
  return own
    .split("\n")
    .map((l) =>
      l
        .replace(/^[#>*\-\s]+/, "")
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .trim()
    )
    .filter((l) => l.length > 0)
    .slice(0, 8);
}

export default function UpdateDialog({
  info,
  onLater,
}: {
  info: UpdateInfo;
  onLater: () => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<"ask" | "installing" | "error">("ask");
  const [progress, setProgress] = useState<{ done: number; total: number | null }>({
    done: 0,
    total: null,
  });
  const [error, setError] = useState("");

  useEffect(() => {
    let off: (() => void) | undefined;
    void listen<{ downloaded: number; total: number | null }>("update-progress", (e) =>
      setProgress({ done: e.payload.downloaded, total: e.payload.total })
    ).then((u) => (off = u));
    return () => off?.();
  }, []);

  const install = async () => {
    setPhase("installing");
    setError("");
    try {
      await invoke("install_app_update");
      // Başarılıysa uygulama yeniden başlar; buraya normalde dönülmez.
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  };

  const pct =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null;
  const lines = noteLines(info.notes);

  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-center bg-black/55 p-6 backdrop-blur-md">
      <div className="animate-panel-in w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/50">
        {/* Üst şerit */}
        <div className="relative overflow-hidden px-6 pb-5 pt-7 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(28rem 12rem at 50% -4rem, color-mix(in oklab, var(--color-accent) 22%, transparent), transparent 70%)",
            }}
          />
          <div className="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
            <Logo className="h-8 w-8" />
          </div>
          <div className="relative mt-4 flex items-center justify-center gap-1.5 text-xs uppercase tracking-[0.18em] text-accent">
            <Sparkles size={13} />
            {t("update.newVersion")}
          </div>
          <div className="font-display relative mt-1.5 text-2xl font-semibold">
            Resonance {info.version}
          </div>
          <div className="relative mt-1 text-xs text-muted">
            {t("update.currentVersion", { version: info.current })}
          </div>
        </div>

        {lines.length > 0 && (
          <div className="mx-6 max-h-40 overflow-y-auto rounded-xl border border-border bg-bg/50 px-4 py-3">
            <ul className="space-y-1.5 text-xs leading-relaxed text-muted">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent/70" />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="px-6 pb-6 pt-5">
          {phase === "installing" ? (
            <div>
              <div className="flex items-center justify-between text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin text-accent" />
                  {pct === 100 ? t("update.applying") : t("update.downloading")}
                </span>
                <span className="tnum">{pct !== null ? `%${pct}` : ""}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div
                  className={`h-full rounded-full bg-accent transition-[width] duration-300 ${
                    pct === null ? "w-1/3 animate-pulse" : ""
                  }`}
                  style={pct !== null ? { width: `${pct}%` } : undefined}
                />
              </div>
              <p className="mt-3 text-center text-[11px] text-faint">{t("update.restartNote")}</p>
            </div>
          ) : (
            <>
              {phase === "error" && (
                <p className="mb-3 break-words rounded-lg bg-down/10 px-3 py-2 text-xs text-down">
                  {t("update.failed", { error })}
                </p>
              )}
              <button
                onClick={() => void install()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
              >
                <Download size={16} />
                {phase === "error" ? t("update.retry") : t("update.installNow")}
              </button>
              <button
                onClick={onLater}
                className="mt-2 w-full rounded-xl py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                {t("update.later")}
              </button>
              <p className="mt-2 text-center text-[11px] text-faint">{t("update.laterNote")}</p>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
