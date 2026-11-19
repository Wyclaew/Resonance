import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Palette, Plus, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useT } from "../lib/i18n";
import { DISCOVERY_FILTERS } from "../lib/filters";
import {
  buildPlaylistTaste,
  getPlaylistStyle,
  setPlaylistStyle,
  type PlaylistStyle,
} from "../lib/playlistProfile";
import Toggle from "./Toggle";

/** Paylaşılan filtre listesinde olmayan sık türler (mobille aynı öneriler). */
const STYLE_SUGGESTIONS = [
  "drift phonk",
  "hardstyle",
  "gym motivation",
  "lo-fi",
  "techno",
  "drill",
  "synthwave",
];
const MAX_STYLES = 3;
const LEARNED_SHOWN = 6;

interface Props {
  playlistId: string;
  playlistName: string;
  onClose: () => void;
}

/**
 * "Bu listenin tarzı" — liste profili (lib/playlistProfile.ts). Tarz seçilir,
 * öğrenilenler gösterilir. Kayıt `playlists.style_json` → senkronlanır.
 */
export default function PlaylistStyleDialog({ playlistId, playlistName, onClose }: Props) {
  const t = useT();
  const [style, setStyle] = useState<PlaylistStyle>(() => getPlaylistStyle(playlistId));
  const [draft, setDraft] = useState("");
  const [learned, setLearned] = useState<[string, number][]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    buildPlaylistTaste(playlistId)
      .then((taste) => {
        if (cancelled) return;
        setLearned(
          [...taste.artists.entries()]
            .filter(([, v]) => Math.abs(v) >= 1)
            .sort((a, b) => b[1] - a[1])
        );
      })
      .catch((e) => console.error("[resonance] liste profili okunamadı:", e));
    return () => {
      cancelled = true;
    };
  }, [playlistId]);

  const moods = useMemo(() => DISCOVERY_FILTERS.filter((f) => f.kind === "mood"), []);
  const genres = useMemo(() => DISCOVERY_FILTERS.filter((f) => f.kind === "genre"), []);
  const liked = learned.filter(([, v]) => v > 0).slice(0, LEARNED_SHOWN);
  const skipped = learned.filter(([, v]) => v < 0).reverse().slice(0, LEARNED_SHOWN);

  const toggleFilter = (id: string) =>
    setStyle((s) => ({
      ...s,
      filters: s.filters.includes(id) ? s.filters.filter((f) => f !== id) : [...s.filters, id],
    }));
  const addStyle = (raw: string) => {
    const v = raw.trim().toLowerCase();
    if (!v || style.styles.includes(v) || style.styles.length >= MAX_STYLES) return;
    setStyle((s) => ({ ...s, styles: [...s.styles, v] }));
    setDraft("");
  };
  const removeStyle = (v: string) =>
    setStyle((s) => ({ ...s, styles: s.styles.filter((x) => x !== v) }));

  const save = async () => {
    setSaving(true);
    try {
      await setPlaylistStyle(playlistId, style);
      onClose();
    } catch (e) {
      console.error("[resonance] liste tarzı kaydedilemedi:", e);
      setSaving(false);
    }
  };

  const chip = (id: string, label: string, on: boolean, onClick: () => void) => (
    <button
      key={id}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        on
          ? "border-accent bg-accent/15 text-text"
          : "border-border text-muted hover:border-border-strong hover:text-text"
      }`}
    >
      {label}
    </button>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="animate-panel-in flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Palette size={16} className="text-accent" />
            {t("plStyle.title", { name: playlistName })}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t("plStyle.body")}</p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <section>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">
              {t("plStyle.mood")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {moods.map((f) =>
                chip(f.id, t(f.labelKey), style.filters.includes(f.id), () => toggleFilter(f.id))
              )}
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">
              {t("plStyle.genre")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {genres.map((f) =>
                chip(f.id, t(f.labelKey), style.filters.includes(f.id), () => toggleFilter(f.id))
              )}
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">
              {t("plStyle.custom")}
            </h3>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {style.styles.map((s) => (
                <span
                  key={s}
                  className="flex items-center gap-1 rounded-full border border-accent bg-accent/15 py-1 pl-2.5 pr-1 text-xs"
                >
                  {s}
                  <button
                    onClick={() => removeStyle(s)}
                    title={t("common.remove")}
                    className="grid h-4 w-4 place-items-center rounded-full text-muted hover:text-text"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
            {style.styles.length < MAX_STYLES && (
              <>
                <div className="flex gap-2">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addStyle(draft);
                    }}
                    placeholder={t("plStyle.customPlaceholder")}
                    className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-border-strong"
                  />
                  <button
                    onClick={() => addStyle(draft)}
                    disabled={!draft.trim()}
                    title={t("plStyle.add")}
                    className="grid h-8 w-8 place-items-center rounded-md bg-surface-2 text-muted hover:text-text disabled:opacity-40"
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {STYLE_SUGGESTIONS.filter((s) => !style.styles.includes(s)).map((s) =>
                    chip(s, `+ ${s}`, false, () => addStyle(s))
                  )}
                </div>
              </>
            )}
          </section>

          <section className="flex items-start justify-between gap-4 rounded-xl border border-border px-3 py-2.5">
            <div>
              <div className="text-sm">{t("plStyle.isolate")}</div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                {t("plStyle.isolateHint")}
              </p>
            </div>
            <Toggle
              checked={style.isolate}
              onChange={(v) => setStyle((s) => ({ ...s, isolate: v }))}
            />
          </section>

          <section>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">
              {t("plStyle.learned")}
            </h3>
            {liked.length === 0 && skipped.length === 0 ? (
              <p className="text-xs text-muted">{t("plStyle.learnedEmpty")}</p>
            ) : (
              <div className="space-y-1.5 text-xs">
                {liked.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ThumbsUp size={12} className="text-up" />
                    {liked.map(([a]) => (
                      <span key={a} className="rounded-full bg-surface-2 px-2 py-0.5 capitalize">
                        {a}
                      </span>
                    ))}
                  </div>
                )}
                {skipped.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ThumbsDown size={12} className="text-down" />
                    {skipped.map(([a]) => (
                      <span key={a} className="rounded-full bg-surface-2 px-2 py-0.5 capitalize text-muted">
                        {a}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="rounded-md bg-surface-2 px-3 py-1.5 text-sm text-text">
            {t("common.cancel")}
          </button>
          <button
            disabled={saving}
            onClick={() => void save()}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-40"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
