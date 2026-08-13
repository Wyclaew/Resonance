import { useEffect, useRef, useState } from "react";
import { User, LogOut, Settings, BarChart3, Cloud, CloudOff } from "lucide-react";
import { useT } from "../lib/i18n";
import { useAppStore } from "../store/useAppStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { isSyncConfigured } from "../lib/sync/config";
import { getSupabase, signOut } from "../lib/sync/client";
import { stopSync, subscribeSync, type SyncState } from "../lib/sync/engine";

// Sağ üstteki yuvarlak profil düğmesi + menüsü (Spotify'daki gibi).
// İçinde: hesap/senkron durumu, dinleme istatistikleri, ayarlar, çıkış.
//
// Avatar YERELDE saklanır (`settings` senkronlanmıyor) — buluta yüklemek
// Supabase Storage kurulumu ister, kişisel uygulamada gereksiz.

export default function ProfileMenu() {
  const t = useT();
  const navigate = useAppStore((s) => s.navigate);
  const avatar = useSettingsStore((s) => s.avatarDataUrl);
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
    void sb.auth.getSession().then(({ data }) =>
      setEmail(data.session?.user.email ?? null)
    );
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) =>
      setEmail(session?.user.email ?? null)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // Dışarı tıklayınca kapan.
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
    // Küçük tut: data URI settings tablosunda saklanıyor, dev dosya koyma.
    if (file.size > 512 * 1024) {
      alert(t("profile.avatarTooBig"));
      return;
    }
    const r = new FileReader();
    r.onload = () => update("avatarDataUrl", String(r.result ?? ""));
    r.readAsDataURL(file);
  };

  const syncLabel = !isSyncConfigured()
    ? t("profile.syncOff")
    : !email
    ? t("profile.notSignedIn")
    : sync?.status === "syncing"
    ? t("sync.statusSyncing")
    : sync?.status === "error"
    ? t("sync.statusError")
    : t("sync.statusIdle");

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={email ?? t("profile.title")}
        className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-surface-2 text-muted transition-colors hover:border-accent hover:text-text"
      >
        {avatar ? (
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          <User size={13} />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-50 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <div className="flex items-center gap-3 border-b border-border p-3">
            <button
              onClick={() => fileRef.current?.click()}
              title={t("profile.changeAvatar")}
              className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-surface-2 text-muted hover:border-accent"
            >
              {avatar ? (
                <img src={avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <User size={18} />
              )}
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
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {email ?? t("profile.local")}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted">
                {isSyncConfigured() && email ? (
                  <Cloud size={11} className="text-accent" />
                ) : (
                  <CloudOff size={11} />
                )}
                <span className="truncate">{syncLabel}</span>
              </div>
            </div>
          </div>

          <MenuItem
            icon={<BarChart3 size={15} />}
            label={t("profile.stats")}
            onClick={() => {
              navigate("stats");
              setOpen(false);
            }}
          />
          <MenuItem
            icon={<Cloud size={15} />}
            label={t("profile.account")}
            onClick={() => {
              navigate("settings");
              setOpen(false);
            }}
          />
          <MenuItem
            icon={<Settings size={15} />}
            label={t("nav.settings")}
            onClick={() => {
              navigate("settings");
              setOpen(false);
            }}
          />
          {email && (
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
