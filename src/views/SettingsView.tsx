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

// M0: ayarlar iskeleti — kategori gezinmesi hazır.
// Detaylı içerik M6'da doldurulacak.
const categories = [
  { id: "playback", label: "Oynatma", icon: Play },
  { id: "storage", label: "Depolama & Önbellek", icon: HardDrive },
  { id: "shortcuts", label: "Kısayollar", icon: Keyboard },
  { id: "integrations", label: "Entegrasyonlar", icon: Plug },
  { id: "appearance", label: "Görünüm", icon: Palette },
  { id: "algorithm", label: "Algoritma", icon: Brain },
  { id: "data", label: "Veri & Yedek", icon: Database },
  { id: "about", label: "Hakkında", icon: Info },
] as const;

type CatId = (typeof categories)[number]["id"];

export default function SettingsView() {
  const [active, setActive] = useState<CatId>("playback");
  const current = categories.find((c) => c.id === active)!;

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Ayarlar" />
      <div className="flex min-h-0 flex-1">
        {/* Kategori menüsü */}
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

        {/* İçerik */}
        <div className="min-w-0 flex-1 overflow-y-auto px-8 py-2">
          <h2 className="mb-1 text-lg font-semibold">{current.label}</h2>
          <p className="text-sm text-muted">
            Bu bölüm M6'da detaylandırılacak.
          </p>
        </div>
      </div>
    </div>
  );
}
