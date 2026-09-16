import { Fragment, useState } from "react";
import type { Playlist } from "../types";
import {
  Sparkles,
  Clock,
  Search,
  Library,
  Link2,
  HardDriveDownload,
  Plus,
  ListMusic,
  PanelLeftClose,
  PanelLeftOpen,
  Loader2,
  ChevronRight,
  Folder as FolderIcon,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { useT } from "../lib/i18n";
import Logo from "./Logo";
import ProfileMenu from "./ProfileMenu";
import type { ViewId } from "../types";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  /** İlk açılış turunun bu düğmeyi bulup vurgulaması için (Onboarding.tsx). */
  tour?: string;
}

function NavItem({ icon, label, active, collapsed, onClick, tour }: NavItemProps) {
  return (
    <button
      data-tour={tour}
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

const CLOSED_KEY = "resonance.closedFolders";

/** Klasörsüzler + (klasör adı, listeler) çiftleri — ikisi de ada göre sıralı. */
function groupByFolder(playlists: Playlist[]) {
  const loose: Playlist[] = [];
  const map = new Map<string, Playlist[]>();
  for (const pl of playlists) {
    const f = (pl.folder ?? "").trim();
    if (!f) loose.push(pl);
    else map.set(f, [...(map.get(f) ?? []), pl]);
  }
  const folders = [...map.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { sensitivity: "base" })
  );
  return { loose, folders };
}

function PlaylistItem({
  pl,
  collapsed,
  active,
  indented,
  onClick,
}: {
  pl: Playlist;
  collapsed: boolean;
  active: boolean;
  indented?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? pl.name : undefined}
      className={`flex w-full items-center rounded-md text-sm transition-colors ${
        collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-3 py-1.5"
      } ${indented ? "pl-7" : ""} ${
        active ? "bg-surface-2 text-text" : "text-muted hover:bg-surface hover:text-text"
      }`}
    >
      <ListMusic size={15} className="shrink-0 text-faint" />
      {!collapsed && <span className="truncate">{pl.name}</span>}
    </button>
  );
}

export default function Sidebar() {
  const t = useT();
  const view = useAppStore((s) => s.view);
  const activePlaylistId = useAppStore((s) => s.activePlaylistId);
  const navigate = useAppStore((s) => s.navigate);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const playlists = usePlaylistStore((s) => s.playlists);
  const createPlaylist = usePlaylistStore((s) => s.create);
  const discovering = usePlayerStore((s) => s.discovering);
  // Kapalı klasörler yalnız BU cihazda (görünüm tercihi, senkronlanmaz).
  const [closedFolders, setClosedFolders] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(CLOSED_KEY) || "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const toggleFolder = (name: string) => {
    setClosedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify([...next]));
      } catch {
        /* depo yoksa yalnız bu oturum */
      }
      return next;
    });
  };
  const grouped = groupByFolder(playlists);

  // Keşfet artık KENDİ SAYFASI (v1.3.0). Sayfaya git; keşif zaten çalışıyorsa
  // startDiscovery mevcut kuyruğu KORUR (force yok) — sayfaya her girişte
  // sıranın sıfırlanmaması için bu şart.
  function handleDiscover() {
    navigate("discover");
    void usePlayerStore.getState().startDiscovery();
  }

  async function handleCreatePlaylist() {
    const p = await createPlaylist(t("nav.newPlaylist"));
    if (p) navigate("playlist", p.id);
  }

  const ICON = 18;

  const nav: { id: ViewId; icon: React.ReactNode; label: string }[] = [
    { id: "now", icon: <Clock size={ICON} />, label: t("nav.now") },
    { id: "search", icon: <Search size={ICON} />, label: t("nav.search") },
    { id: "library", icon: <Library size={ICON} />, label: t("nav.library") },
    {
      id: "downloads",
      icon: <HardDriveDownload size={ICON} />,
      label: t("nav.downloads"),
    },
    { id: "import", icon: <Link2 size={ICON} />, label: t("nav.import") },
  ];

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-border bg-bg transition-[width] duration-150 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      {/* Logo + daralt/genişlet */}
      <div
        className={`flex items-center pb-3 pt-1 ${
          collapsed ? "flex-col gap-3 px-2" : "justify-between px-4"
        }`}
      >
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent">
              <Logo className="h-[18px] w-[18px]" />
            </div>
            <span className="font-display text-[16px] font-semibold">
              Resonance
            </span>
          </div>
        )}
        {collapsed && (
          <div className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent">
            <Logo className="h-[18px] w-[18px]" />
          </div>
        )}
        <button
          onClick={toggleSidebar}
          title={collapsed ? t("nav.expand") : t("nav.collapse")}
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
          <Fragment key={n.id}>
            <NavItem
              icon={n.icon}
              label={n.label}
              active={view === n.id}
              collapsed={collapsed}
              onClick={() => navigate(n.id)}
              tour={`nav-${n.id}`}
            />
            {/* "Şu An"dan hemen sonra: Keşfet (aksiyon — keşif çalmasını başlatır). */}
            {n.id === "now" && (
              <button
                data-tour="nav-discover"
                onClick={handleDiscover}
                disabled={discovering}
                title={collapsed ? (discovering ? t("nav.preparing") : t("nav.discover")) : undefined}
                className={`group relative flex w-full items-center rounded-md text-sm text-accent transition-all hover:bg-accent/10 disabled:opacity-70 ${
                  collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
                } ${view === "discover" ? "bg-accent/10" : ""}`}
              >
                {/* Keşif çalıyorken sol vurgu çizgisi — NavItem'daki ile aynı dil. */}
                {view === "discover" && !collapsed && (
                  <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
                )}
                <span className="transition-colors">
                  {discovering ? (
                    <Loader2 size={ICON} className="animate-spin" />
                  ) : (
                    <Sparkles size={ICON} />
                  )}
                </span>
                {!collapsed && (
                  <span className="truncate">
                    {discovering ? t("nav.preparing") : t("nav.discover")}
                  </span>
                )}
              </button>
            )}
          </Fragment>
        ))}
      </nav>

      {/* Playlistler */}
      {!collapsed && (
        <div className="mt-2 flex items-center justify-between px-4 pb-1 pt-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
            {t("nav.playlists")}
          </span>
          <button
            onClick={handleCreatePlaylist}
            className="text-faint hover:text-text"
            title={t("nav.newPlaylist")}
            aria-label={t("nav.newPlaylist")}
          >
            <Plus size={15} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2">
        {playlists.length === 0 ? (
          !collapsed && (
            <p className="px-3 py-2 text-xs leading-relaxed text-faint">
              {t("nav.noPlaylists")}
            </p>
          )
        ) : (
          <>
            {/* Klasörsüz listeler önce, sonra klasörler (v1.9.6). Klasör bir
                etikettir; açık/kapalı durumu yalnız bu cihazda tutulur. */}
            {grouped.loose.map((pl) => (
              <PlaylistItem
                key={pl.id}
                pl={pl}
                collapsed={collapsed}
                active={view === "playlist" && activePlaylistId === pl.id}
                onClick={() => navigate("playlist", pl.id)}
              />
            ))}
            {grouped.folders.map(([folder, items]) => {
              const open = !closedFolders.has(folder);
              return (
                <Fragment key={folder}>
                  {!collapsed && (
                    <button
                      onClick={() => toggleFolder(folder)}
                      className="mt-1 flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-xs font-medium text-muted hover:bg-surface hover:text-text"
                    >
                      <ChevronRight
                        size={13}
                        className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                      />
                      <FolderIcon size={13} className="shrink-0 text-faint" />
                      <span className="truncate">{folder}</span>
                      <span className="ml-auto text-[11px] text-faint">{items.length}</span>
                    </button>
                  )}
                  {(open || collapsed) &&
                    items.map((pl) => (
                      <PlaylistItem
                        key={pl.id}
                        pl={pl}
                        collapsed={collapsed}
                        indented={!collapsed}
                        active={view === "playlist" && activePlaylistId === pl.id}
                        onClick={() => navigate("playlist", pl.id)}
                      />
                    ))}
                </Fragment>
              );
            })}
          </>
        )}
      </div>

      <div className="border-t border-border px-2 py-2">
        {/* Profil — Ayarlar'ın hemen üstü. Eskiden pencere başlık şeridindeydi:
            24px'lik düğme hem küçük hem de sürükleme bölgesiyle çakışıyordu. */}
        {/* Ayarlar artık PROFİL MENÜSÜNÜN İÇİNDE — hesap, tema, dil ve
            ayarların hepsi tek yerde toplandı. */}
        <ProfileMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
