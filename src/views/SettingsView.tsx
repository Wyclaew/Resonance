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
  ChevronDown,
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

const BROWSERS = [
  { v: "", label: "Kapalı" },
  { v: "safari", label: "Safari" },
  { v: "chrome", label: "Chrome" },
  { v: "brave", label: "Brave" },
  { v: "edge", label: "Edge" },
  { v: "firefox", label: "Firefox" },
  { v: "opera", label: "Opera" },
  { v: "opera-gx", label: "Opera GX" },
  { v: "vivaldi", label: "Vivaldi" },
];

function IntegrationsSettings() {
  const cookiesBrowser = useSettingsStore((s) => s.cookiesBrowser);
  const spotifyClientId = useSettingsStore((s) => s.spotifyClientId);
  const spotifyClientSecret = useSettingsStore((s) => s.spotifyClientSecret);
  const update = useSettingsStore((s) => s.update);

  return (
    <div className="max-w-2xl">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        YouTube
      </div>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        YouTube, giriş yapılmadan bir çalma listesinin en fazla ~100 şarkısını
        verir ve özel listelere izin vermez. Tarayıcını seçersen uygulama, o
        tarayıcıdaki YouTube oturumunu (çerezleri) kullanır: <b className="text-text">tüm
        şarkılar (100+)</b>, özel listelerin ve daha az bot engeli. Çerezler
        cihazında kalır, hiçbir yere gönderilmez.
      </p>
      <SettingRow
        label="Hesap için tarayıcı"
        description="Hangi tarayıcıdaki YouTube oturumun kullanılsın? O tarayıcıda YouTube'a giriş yapmış olmalısın."
      >
        <div className="relative">
          <select
            value={cookiesBrowser}
            onChange={(e) => update("cookiesBrowser", e.target.value)}
            className="w-44 cursor-pointer appearance-none rounded-md border border-border bg-surface py-1.5 pl-3 pr-9 text-sm text-text outline-none transition-colors hover:border-border-strong focus:border-border-strong"
          >
            {BROWSERS.map((b) => (
              <option key={b.v} value={b.v}>
                {b.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={15}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
        </div>
      </SettingRow>

      <div className="mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        Spotify
      </div>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        Spotify'ın sesi alınamaz; bir Spotify listesini içe aktarınca şarkı
        adları okunur ve <b className="text-text">YouTube'da eşleştirilip</b>{" "}
        oradan çalınır. Bunun için tek seferlik <b className="text-text">ücretsiz</b>{" "}
        bir Spotify API anahtarı gerekir:{" "}
        <span className="text-accent">developer.spotify.com</span> → Dashboard →
        Create app → Client ID ve Client Secret'ı buraya yapıştır (Redirect URI
        zorunlu değil). Anahtarlar cihazında kalır.
      </p>
      <SettingRow label="Client ID" description="Spotify Developer Dashboard'dan">
        <input
          value={spotifyClientId}
          onChange={(e) => update("spotifyClientId", e.target.value.trim())}
          placeholder="örn. 4a1b…"
          className="w-56 rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-border-strong"
        />
      </SettingRow>
      <SettingRow label="Client Secret" description="Gizli tut; kimseyle paylaşma.">
        <input
          type="password"
          value={spotifyClientSecret}
          onChange={(e) => update("spotifyClientSecret", e.target.value.trim())}
          placeholder="••••••••"
          className="w-56 rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-border-strong"
        />
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
          ) : active === "integrations" ? (
            <IntegrationsSettings />
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
