import {
  Sparkles,
  Search,
  Library,
  Settings,
  Link2,
  HardDriveDownload,
  Plus,
  ListMusic,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import type { ViewId } from "../types";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}

function NavItem({ icon, label, active, collapsed, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`group relative flex w-full items-center rounded-md text-sm transition-all ${
        collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
      } ${
        active
          ? "bg-surface-2 text-text"
          : "text-muted hover:bg-surface hover:text-text"
      }`}
    >
      {active && !collapsed && (
        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
      )}
      <span
        className={`transition-colors ${
          active ? "text-accent" : "group-hover:text-text"
        }`}
      >
        {icon}
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}

export default function Sidebar() {
  const view = useAppStore((s) => s.view);
  const activePlaylistId = useAppStore((s) => s.activePlaylistId);
  const navigate = useAppStore((s) => s.navigate);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const playlists = usePlaylistStore((s) => s.playlists);
  const createPlaylist = usePlaylistStore((s) => s.create);

  async function handleCreatePlaylist() {
    const p = await createPlaylist("Yeni Liste");
    if (p) navigate("playlist", p.id);
  }

  const ICON = 18;

  const nav: { id: ViewId; icon: React.ReactNode; label: string }[] = [
    { id: "now", icon: <Sparkles size={ICON} />, label: "Şu An" },
    { id: "search", icon: <Search size={ICON} />, label: "Ara" },
    { id: "library", icon: <Library size={ICON} />, label: "Kütüphane" },
    {
      id: "downloads",
      icon: <HardDriveDownload size={ICON} />,
      label: "İndirilenler",
    },
    { id: "import", icon: <Link2 size={ICON} />, label: "İçe Aktar" },
  ];

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-border bg-bg transition-[width] duration-150 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      {/* Logo + daralt/genişlet */}
      <div
        className={`flex items-center pt-5 pb-3 ${
          collapsed ? "flex-col gap-3 px-2" : "justify-between px-4"
        }`}
      >
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent">
              <span className="text-base font-semibold">◈</span>
            </div>
            <span className="text-[15px] font-semibold tracking-tight">
              Resonance
            </span>
          </div>
        )}
        {collapsed && (
          <div className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent">
            <span className="text-base font-semibold">◈</span>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          title={collapsed ? "Genişlet" : "Daralt"}
          className="text-faint hover:text-text"
        >
          {collapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 py-2">
        {nav.map((n) => (
          <NavItem
            key={n.id}
            icon={n.icon}
            label={n.label}
            active={view === n.id}
            collapsed={collapsed}
            onClick={() => navigate(n.id)}
          />
        ))}
      </nav>

      {/* Playlistler */}
      {!collapsed && (
        <div className="mt-2 flex items-center justify-between px-4 pb-1 pt-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
            Çalma Listeleri
          </span>
          <button
            onClick={handleCreatePlaylist}
            className="text-faint hover:text-text"
            title="Yeni çalma listesi"
            aria-label="Yeni çalma listesi"
          >
            <Plus size={15} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2">
        {playlists.length === 0
          ? !collapsed && (
              <p className="px-3 py-2 text-xs leading-relaxed text-faint">
                Henüz çalma listen yok. Bir tane oluştur veya Spotify/YouTube
                Music'ten içe aktar.
              </p>
            )
          : playlists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => navigate("playlist", pl.id)}
                title={collapsed ? pl.name : undefined}
                className={`flex w-full items-center rounded-md text-sm transition-colors ${
                  collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-3 py-1.5"
                } ${
                  view === "playlist" && activePlaylistId === pl.id
                    ? "bg-surface-2 text-text"
                    : "text-muted hover:bg-surface hover:text-text"
                }`}
              >
                <ListMusic size={15} className="shrink-0 text-faint" />
                {!collapsed && <span className="truncate">{pl.name}</span>}
              </button>
            ))}
      </div>

      <div className="border-t border-border px-2 py-2">
        <NavItem
          icon={<Settings size={ICON} />}
          label="Ayarlar"
          active={view === "settings"}
          collapsed={collapsed}
          onClick={() => navigate("settings")}
        />
      </div>
    </aside>
  );
}
