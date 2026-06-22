import { useState } from "react";
import {
  Play,
  HardDrive,
  Keyboard,
  Plug,
  Palette,
  Database,
  Brain,
  Info,
} from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import Toggle from "../components/Toggle";
import { useSettingsStore } from "../store/useSettingsStore";

const categories = [
  { id: "playback", label: "Oynatma", icon: Play },
  { id: "storage", label: "Depolama & Önbellek", icon: HardDrive },
  { id: "shortcuts", label: "Kısayollar", icon: Keyboard },
  { id: "integrations", label: "Entegrasyonlar", icon: Plug },
  { id: "appearance", label: "Görünüm", icon: Palette },
  { id: "algorithm", label: "Resonance Önerisi", icon: Brain },
  { id: "data", label: "Veri & Yedek", icon: Database },
  { id: "about", label: "Hakkında", icon: Info },
] as const;

type CatId = (typeof categories)[number]["id"];

function SettingRow({
  label,
  description,
  children,
  disabled,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-6 border-b border-border py-4 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="mt-0.5 text-xs leading-relaxed text-muted">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function AlgorithmSettings() {
  const s = useSettingsStore();
  const noSource = !s.recYouTube && !s.recLibrary;

  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm leading-relaxed text-muted">
        Resonance, hangi gün ve saatte hangi şarkıya upvote/downvote verdiğini
        öğrenir ve çalma listesi dinlerken araya sana uygun şarkılar ekler.
        Bu öneriler "✦ Resonance" rozetiyle işaretlenir; dilersen geçersin.
      </p>

      <SettingRow
        label="Resonance önerileri"
        description="Çalma listesi dinlerken araya önerilen şarkılar eklensin."
      >
        <Toggle
          checked={s.recEnabled}
          onChange={(v) => s.update("recEnabled", v)}
        />
      </SettingRow>

      <div className="mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        Öneriler nereden gelsin?
      </div>

      <SettingRow
        label="YouTube'dan benzer"
        description="Upvote'ladığın şarkı ve sanatçılara göre YouTube'da benzerlerini bulur. Yeni keşif."
        disabled={!s.recEnabled}
      >
        <Toggle
          checked={s.recYouTube}
          disabled={!s.recEnabled}
          onChange={(v) => s.update("recYouTube", v)}
        />
      </SettingRow>

      <SettingRow
        label="Kendi playlistlerim"
        description="Diğer çalma listelerin ve indirdiklerin arasından o anki bağlama uyanları önerir."
        disabled={!s.recEnabled}
      >
        <Toggle
          checked={s.recLibrary}
          disabled={!s.recEnabled}
          onChange={(v) => s.update("recLibrary", v)}
        />
      </SettingRow>

      {s.recEnabled && noSource && (
        <p className="mt-3 text-xs text-down">
          En az bir kaynak açık olmalı, yoksa öneri gelmez.
        </p>
      )}

      <div className="mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        Karma
      </div>
      <SettingRow
        label="Karma yarı ömrü"
        description="Oyların ne kadar sürede yarı değere düşeceği (gün). Düşük = daha hızlı unutur."
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={365}
            value={s.karmaHalfLifeDays}
            onChange={(e) =>
              s.update(
                "karmaHalfLifeDays",
                Math.max(1, Math.min(365, Number(e.target.value) || 30))
              )
            }
            className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm outline-none focus:border-border-strong"
          />
          <span className="text-xs text-muted">gün</span>
        </div>
      </SettingRow>
    </div>
  );
}

export default function SettingsView() {
  const [active, setActive] = useState<CatId>("algorithm");
  const current = categories.find((c) => c.id === active)!;

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Ayarlar" />
      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 overflow-y-auto px-4 py-1">
          {categories.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                onClick={() => setActive(c.id)}
                className={`mb-0.5 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  active === c.id
                    ? "bg-surface-2 text-text"
                    : "text-muted hover:bg-surface hover:text-text"
                }`}
              >
                <Icon size={16} className={active === c.id ? "text-accent" : ""} />
                {c.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto px-8 py-2">
          <h2 className="mb-4 text-lg font-semibold">{current.label}</h2>
          {active === "algorithm" ? (
            <AlgorithmSettings />
          ) : (
            <p className="text-sm text-muted">
              Bu bölüm yakında detaylandırılacak (M6).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
