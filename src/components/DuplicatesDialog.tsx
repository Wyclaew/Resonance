import { useState } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, Copy } from "lucide-react";
import { useT } from "../lib/i18n";
import type { DuplicateGroup } from "../lib/duplicates";
import { formatMs } from "../lib/format";

/**
 * Listedeki tekrarları gösterir; her grupta hangisinin KALACAĞI seçilir,
 * gerisi listeden çıkarılır (çağıran taraf "Geri al" sunar).
 */
export default function DuplicatesDialog({
  groups,
  downloaded,
  plays,
  onClose,
  onApply,
}: {
  groups: DuplicateGroup[];
  downloaded: Set<string>;
  plays: Map<string, number>;
  onClose: () => void;
  onApply: (removeIds: string[]) => void;
}) {
  const t = useT();
  const [keep, setKeep] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((g) => [g.key, g.keepId]))
  );
  const removeIds = groups.flatMap((g) =>
    g.tracks.filter((tr) => tr.id !== keep[g.key]).map((tr) => tr.id)
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="animate-panel-in flex max-h-[80vh] w-full max-w-xl flex-col rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Copy size={16} className="text-accent" />
            {t("dups.title", { n: groups.length })}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t("dups.body")}</p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {groups.map((g) => (
            <div key={g.key} className="rounded-xl border border-border p-2">
              {g.tracks.map((tr) => {
                const chosen = keep[g.key] === tr.id;
                return (
                  <button
                    key={tr.id}
                    onClick={() => setKeep((k) => ({ ...k, [g.key]: tr.id }))}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${
                      chosen ? "bg-accent/10" : "hover:bg-surface-2"
                    }`}
                  >
                    <span
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                        chosen ? "border-accent bg-accent" : "border-border-strong"
                      }`}
                    >
                      {chosen && <span className="h-1.5 w-1.5 rounded-full bg-bg" />}
                    </span>
                    {tr.thumbnail ? (
                      <img src={tr.thumbnail} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                    ) : (
                      <span className="h-9 w-9 shrink-0 rounded bg-surface-3" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${chosen ? "" : "text-muted"}`}>
                        {tr.title}
                      </span>
                      <span className="block truncate text-xs text-faint">
                        {tr.artist} · {formatMs(tr.durationMs)}
                        {(plays.get(tr.id) ?? 0) > 0
                          ? ` · ${t("dups.plays", { n: plays.get(tr.id) ?? 0 })}`
                          : ""}
                        {/* karma ondalıklı (decay) — yuvarlayınca 0 olan gösterilmez */}
                        {Math.round(tr.karma) !== 0 ? ` · karma ${Math.round(tr.karma)}` : ""}
                      </span>
                    </span>
                    {downloaded.has(tr.id) && (
                      <CircleCheck size={15} className="shrink-0 text-up" />
                    )}
                    <span
                      className={`shrink-0 text-[11px] ${chosen ? "text-accent" : "text-faint"}`}
                    >
                      {chosen ? t("dups.keep") : t("dups.remove")}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <span className="text-xs text-muted">{t("dups.summary", { n: removeIds.length })}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md bg-surface-2 px-3 py-1.5 text-sm text-text">
              {t("common.cancel")}
            </button>
            <button
              disabled={removeIds.length === 0}
              onClick={() => onApply(removeIds)}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-40"
            >
              {t("dups.apply")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
