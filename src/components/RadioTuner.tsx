import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Radio, X, Loader2 } from "lucide-react";
import { useT } from "../lib/i18n";
import {
  buildStation,
  libraryArtists,
  loadLastStation,
  type Energy,
  type Familiarity,
} from "../lib/radioTuner";
import { usePlayerStore } from "../store/usePlayerStore";
import { useToastStore } from "../store/useToastStore";

const FAM: Familiarity[] = ["known", "mixed", "new"];
const ENE: Energy[] = ["calm", "any", "upbeat"];

/** Radyo ayarlayıcı penceresi (v1.9.8) — mantık `lib/radioTuner.ts`. */
export default function RadioTuner({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toast = useToastStore((s) => s.show);
  const playNow = usePlayerStore((s) => s.playNow);
  const last = loadLastStation();
  const [artists, setArtists] = useState<string[]>(last?.artists ?? []);
  const [fam, setFam] = useState<Familiarity>(last?.familiarity ?? "mixed");
  const [energy, setEnergy] = useState<Energy>(last?.energy ?? "any");
  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void libraryArtists().then(setLibrary);
  }, []);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const picked = new Set(artists.map((a) => a.toLowerCase()));
    return library
      .filter((a) => !picked.has(a.toLowerCase()) && (!q || a.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [query, library, artists]);

  const addArtist = (a: string) => {
    const v = a.trim();
    if (!v || artists.length >= 5) return;
    if (artists.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setArtists([...artists, v]);
    setQuery("");
  };

  const start = async () => {
    setBusy(true);
    try {
      const list = await buildStation({ artists, familiarity: fam, energy });
      if (list.length === 0) {
        toast(t("tuner.empty"), "error");
        return;
      }
      playNow(list[0], list);
      toast(t("tuner.started", { n: list.length }), "success");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const Steps = <T extends string>({
    value,
    options,
    labels,
    onChange,
  }: {
    value: T;
    options: T[];
    labels: Record<T, string>;
    onChange: (v: T) => void;
  }) => (
    <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
            value === o ? "bg-accent font-medium text-bg" : "text-muted hover:text-text"
          }`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="animate-panel-in w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Radio size={16} className="text-accent" />
          {t("tuner.title")}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{t("tuner.body")}</p>

        <div className="mt-4 text-xs font-medium text-muted">{t("tuner.artists")}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {artists.map((a) => (
            <span
              key={a}
              className="flex items-center gap-1 rounded-full bg-accent/15 py-1 pl-2.5 pr-1.5 text-xs text-accent"
            >
              {a}
              <button
                onClick={() => setArtists(artists.filter((x) => x !== a))}
                className="rounded-full p-0.5 hover:bg-accent/20"
                aria-label={t("common.remove")}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addArtist(suggestions[0] && query.trim() === "" ? suggestions[0] : query);
          }}
          disabled={artists.length >= 5}
          placeholder={artists.length >= 5 ? t("tuner.max") : t("tuner.artistPlaceholder")}
          className="mt-2 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
        />
        {suggestions.length > 0 && artists.length < 5 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {suggestions.map((a) => (
              <button
                key={a}
                onClick={() => addArtist(a)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:border-accent/50 hover:text-text"
              >
                + {a}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 text-xs font-medium text-muted">{t("tuner.familiarity")}</div>
        <div className="mt-1.5">
          <Steps
            value={fam}
            options={FAM}
            labels={{ known: t("tuner.famKnown"), mixed: t("tuner.famMixed"), new: t("tuner.famNew") }}
            onChange={setFam}
          />
        </div>

        <div className="mt-4 text-xs font-medium text-muted">{t("tuner.energy")}</div>
        <div className="mt-1.5">
          <Steps
            value={energy}
            options={ENE}
            labels={{ calm: t("tuner.eneCalm"), any: t("tuner.eneAny"), upbeat: t("tuner.eneUp") }}
            onChange={setEnergy}
          />
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-faint">{t("tuner.energyNote")}</p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md bg-surface-2 px-3 py-1.5 text-sm text-text disabled:opacity-40"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => void start()}
            disabled={busy || artists.length === 0}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? t("tuner.building") : t("tuner.start")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
