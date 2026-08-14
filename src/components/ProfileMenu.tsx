import { useEffect, useRef, useState } from "react";
import {
  User,
  LogOut,
  BarChart3,
  Cloud,
  CloudOff,
  ChevronUp,
  Moon,
  Sun,
  Languages,
} from "lucide-react";
import { useT, type Lang } from "../lib/i18n";
import { useAppStore } from "../store/useAppStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { isSyncConfigured } from "../lib/sync/config";
import { getSupabase, signOut } from "../lib/sync/client";
import { stopSync, subscribeSync, type SyncState } from "../lib/sync/engine";

// Profil — SIDEBAR'IN ALTINDA, Ayarlar'ın hemen üstünde.
//
// Eskiden pencere başlık şeridindeydi: 24px'lik düğme hem çok küçüktü hem de
// sürükleme bölgesiyle aynı yerdeydi. Sidebar tabanı hem her sayfada sabit,
// hem de görünüm başlıklarındaki aksiyon düğmeleriyle çakışmıyor.
//
// Menü YUKARI açılır (altta yer yok).
// Avatar YERELDE saklanır — `settings` senkronlanmıyor.

export default function ProfileMenu({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const navigate = useAppStore((s) => s.navigate);
  const view = useAppStore((s) => s.view);
  const avatar = useSettingsStore((s) => s.avatarDataUrl);
  const theme = useSettingsStore((s) => s.theme);
  const language = useSettingsStore((s) => s.language);
  const update = useSettingsStore((s) => s.update);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeSync(setSync), []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    void sb.auth
      .getSession()
      .then(({ data }) => setEmail(data.session?.user.email ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) =>
      setEmail(session?.user.email ?? null)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pickAvatar = (file: File) => {
    // Data URI settings tablosunda saklanıyor → büyük dosya koyma.
    if (file.size > 512 * 1024) {
      alert(t("profile.avatarTooBig"));
      return;
    }
    const r = new FileReader();
    r.onload = () => update("avatarDataUrl", String(r.result ?? ""));
    r.readAsDataURL(file);
  };

  // Gerçekte açık temada mıyız? Ayar "system" olabileceği için DOM'daki
  // data-theme'e bakılır (App.tsx orayı yazıyor).
  const isLight =
    theme === "light" ||
    (theme === "system" &&
      typeof document !== "undefined" &&
      document.documentElement.getAttribute("data-theme") === "light");

  const signedIn = isSyncConfigured() && !!email;
  const syncLabel = !isSyncConfigured()
    ? t("profile.syncOff")
    : !email
    ? t("profile.notSignedIn")
    : sync?.status === "syncing"
    ? t("sync.statusSyncing")
    : sync?.status === "error"
    ? t("sync.statusError")
    : t("sync.statusIdle");

  const Avatar = ({ size }: { size: number }) => (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-surface-2 text-muted"
      style={{ width: size, height: size }}
    >
      {avatar ? (
        <img src={avatar} alt="" className="h-full w-full object-cover" />
      ) : (
        <User size={Math.round(size * 0.55)} />
      )}
    </span>
  );

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? email ?? t("profile.title") : undefined}
        className={`group relative mb-0.5 flex w-full items-center rounded-md text-sm transition-colors ${
          collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2 py-2"
        } ${
          open || view === "account" || view === "stats"
            ? "bg-surface-2 text-text"
            : "text-muted hover:bg-surface hover:text-text"
        }`}
      >
        <Avatar size={collapsed ? 22 : 26} />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px] font-medium text-text">
                {email ?? t("profile.local")}
              </span>
              <span className="flex items-center gap-1 text-[11px] text-muted">
                {signedIn ? (
                  <Cloud size={10} className="shrink-0 text-accent" />
                ) : (
                  <CloudOff size={10} className="shrink-0" />
                )}
                <span className="truncate">{syncLabel}</span>
              </span>
            </span>
            <ChevronUp
              size={14}
              className={`shrink-0 text-faint transition-transform ${
                open ? "" : "rotate-180"
              }`}
            />
          </>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-60 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          {/* Avatar değiştir */}
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center gap-3 border-b border-border p-3 text-left transition-colors hover:bg-surface-2"
          >
            <Avatar size={36} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {email ?? t("profile.local")}
              </span>
              <span className="block truncate text-xs text-muted">
                {t("profile.changeAvatar")}
              </span>
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickAvatar(f);
              e.target.value = "";
            }}
          />

          <MenuItem
            icon={<Cloud size={15} />}
            label={t("profile.account")}
            onClick={() => {
              navigate("account");
              setOpen(false);
            }}
          />
          <MenuItem
            icon={<BarChart3 size={15} />}
            label={t("profile.stats")}
            onClick={() => {
              navigate("stats");
              setOpen(false);
            }}
          />

          <div className="border-t border-border" />

          {/* Hızlı ayarlar — en sık değiştirilen ikisi (Ayarlar'a girmeden). */}
          {/* Etiket HEDEFİ gösterir (tıklayınca ne olacağı). "system" seçiliyse
              gerçekte hangi temada olduğumuzu DOM'dan okuruz — ayarın kendisi
              "system" olduğu için tek başına yeterli değil. */}
          <MenuItem
            icon={isLight ? <Moon size={15} /> : <Sun size={15} />}
            label={isLight ? t("profile.themeDark") : t("profile.themeLight")}
            onClick={() => update("theme", isLight ? "dark" : "light")}
          />
          <MenuItem
            icon={<Languages size={15} />}
            label={language === "tr" ? "Türkçe" : "English"}
            onClick={() =>
              update("language", (language === "tr" ? "en" : "tr") as Lang)
            }
          />

          {signedIn && (
            <>
              <div className="border-t border-border" />
              <MenuItem
                icon={<LogOut size={15} />}
                label={t("sync.signOut")}
                danger
                onClick={() => {
                  stopSync();
                  void signOut();
                  setOpen(false);
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 ${
        danger ? "text-down" : "text-text"
      }`}
    >
      <span className={danger ? "text-down" : "text-muted"}>{icon}</span>
      {label}
    </button>
  );
}
