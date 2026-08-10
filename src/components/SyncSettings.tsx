import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Cloud,
  CloudOff,
  RefreshCw,
  LogOut,
  Upload,
  Download,
  AlertTriangle,
  Check,
} from "lucide-react";
import { useT } from "../lib/i18n";
import { getDeviceId } from "../lib/device";
import { isSyncConfigured } from "../lib/sync/config";
import {
  getSupabase,
  resetPassword,
  signIn,
  signOut,
  signUp,
} from "../lib/sync/client";
import {
  firstSyncPullReplace,
  firstSyncPushAll,
  hasSyncedBefore,
  startSync,
  stopSync,
  subscribeSync,
  syncNow,
  type SyncState,
} from "../lib/sync/engine";
import { useToastStore } from "../store/useToastStore";

// Ayarlar → Hesap: bulut senkronu (giriş, durum, ilk-senkron sihirbazı).

function fmtTime(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SyncSettings() {
  const t = useT();
  const toast = useToastStore((s) => s.show);
  const deviceId = getDeviceId();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [authMode, setAuthMode] = useState<"in" | "up">("in");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [needsFirstSync, setNeedsFirstSync] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);
  const [sync, setSync] = useState<SyncState | null>(null);

  const configured = isSyncConfigured();

  useEffect(() => subscribeSync(setSync), []);

  // Oturum durumunu izle (giriş/çıkış anında UI güncellensin).
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    const apply = async (mail: string | null) => {
      if (!alive) return;
      setUserEmail(mail);
      if (mail) setNeedsFirstSync(!(await hasSyncedBefore()));
    };
    void sb.auth.getSession().then(({ data }) =>
      apply(data.session?.user.email ?? null)
    );
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) =>
      void apply(session?.user.email ?? null)
    );
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!configured) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center gap-2 text-muted">
            <CloudOff size={18} />
            <span className="text-sm font-semibold">
              {t("sync.notConfigured")}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {t("sync.notConfiguredBody")}
          </p>
          <code className="mt-3 block rounded bg-surface-2 px-3 py-2 font-mono text-xs text-faint">
            src/lib/sync/config.ts
          </code>
        </div>
        <DeviceRow deviceId={deviceId} />
      </div>
    );
  }

  const doAuth = async (mode: "in" | "up") => {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "in") await signIn(email.trim(), password);
      else {
        await signUp(email.trim(), password);
        setNotice(t("sync.signUpDone"));
      }
      setPassword("");
      setPassword2("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await resetPassword(email);
      setNotice(t("sync.resetSent"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doFirstSync = async (mode: "push" | "pull") => {
    setBusy(true);
    setErr(null);
    try {
      // Her iki modda da ÖNCE yedek: pull yıkıcıdır, push'ta da zararı yok.
      await invoke("backup_db").catch(() => {});
      if (mode === "push") await firstSyncPushAll();
      else await firstSyncPullReplace();
      setNeedsFirstSync(false);
      setConfirmPull(false);
      await startSync();
      toast(t("sync.firstDone"), "success");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ── Giriş yapılmamış ──
  // Giriş ve KAYIT ayrı sekmeler: eskiden iki düğme yan yanaydı ve kullanıcı
  // hangisinde olduğunu karıştırıp yanlış butona basıyordu.
  if (!userEmail) {
    const canSubmit =
      !busy &&
      email.trim().length > 0 &&
      password.length >= 6 &&
      (authMode === "in" || password === password2);
    return (
      <div className="max-w-2xl">
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-5">
          <div className="flex items-center gap-2 text-accent">
            <Cloud size={18} />
            <span className="text-sm font-semibold">{t("sync.signInTitle")}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {t("sync.signInBody")}
          </p>

          {/* Sekmeler */}
          <div className="mt-4 flex gap-1 rounded-md bg-surface-2 p-1">
            {(["in", "up"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setAuthMode(m);
                  setErr(null);
                  setNotice(null);
                  setPassword2("");
                }}
                className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${
                  authMode === m
                    ? "bg-accent font-medium text-bg"
                    : "text-muted hover:text-text"
                }`}
              >
                {m === "in" ? t("sync.signIn") : t("sync.signUp")}
              </button>
            ))}
          </div>

          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) void doAuth(authMode);
            }}
          >
            {/* name + autoComplete: şifre yöneticileri ve OS anahtar zinciri
                alanları ancak bu ipuçlarıyla tanır. */}
            <input
              type="email"
              name="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("sync.email")}
              autoComplete="username"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <input
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("sync.password")}
              autoComplete={
                authMode === "in" ? "current-password" : "new-password"
              }
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {authMode === "up" && (
              <input
                type="password"
                name="password_confirm"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder={t("sync.passwordAgain")}
                autoComplete="new-password"
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            )}
            {authMode === "up" &&
              password2.length > 0 &&
              password !== password2 && (
                <p className="text-xs text-down">{t("sync.passwordMismatch")}</p>
              )}
            {authMode === "up" && password.length > 0 && password.length < 6 && (
              <p className="text-xs text-muted">{t("sync.passwordTooShort")}</p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-40"
              >
                {authMode === "in" ? t("sync.signIn") : t("sync.signUp")}
              </button>
              {authMode === "in" && (
                <button
                  type="button"
                  disabled={busy || !email.trim()}
                  onClick={() => void doReset()}
                  className="text-sm text-muted underline-offset-2 hover:text-text hover:underline disabled:opacity-40"
                >
                  {t("sync.forgot")}
                </button>
              )}
            </div>
          </form>

          {authMode === "up" && (
            <p className="mt-3 text-xs text-faint">{t("sync.signUpNote")}</p>
          )}
          {notice && <p className="mt-3 text-sm text-up">{notice}</p>}
          {err && <p className="mt-3 text-sm text-down">{err}</p>}
        </div>
        <DeviceRow deviceId={deviceId} />
      </div>
    );
  }

  // ── Giriş yapılmış, ilk senkron seçimi bekliyor ──
  if (needsFirstSync) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-accent" />
            <span className="text-sm font-semibold">{t("sync.firstTitle")}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {t("sync.firstBody")}
          </p>

          <div className="mt-4 space-y-2">
            <button
              disabled={busy}
              onClick={() => void doFirstSync("push")}
              className="flex w-full items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:border-accent disabled:opacity-40"
            >
              <Upload size={16} className="mt-0.5 shrink-0 text-accent" />
              <span>
                <span className="block text-sm font-medium">
                  {t("sync.firstPush")}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {t("sync.firstPushDesc")}
                </span>
              </span>
            </button>

            <button
              disabled={busy}
              onClick={() => setConfirmPull(true)}
              className="flex w-full items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:border-down disabled:opacity-40"
            >
              <Download size={16} className="mt-0.5 shrink-0 text-down" />
              <span>
                <span className="block text-sm font-medium">
                  {t("sync.firstPull")}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {t("sync.firstPullDesc")}
                </span>
              </span>
            </button>
          </div>

          {confirmPull && (
            <div className="mt-3 rounded-md border border-down/40 bg-down/5 p-3">
              <p className="text-sm text-text">{t("sync.firstPullConfirm")}</p>
              <div className="mt-3 flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => void doFirstSync("pull")}
                  className="rounded-md bg-down px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  {t("sync.firstPullConfirmYes")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => setConfirmPull(false)}
                  className="rounded-md bg-surface-2 px-3 py-1.5 text-sm text-text disabled:opacity-40"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}

          {busy && (
            <p className="mt-3 text-sm text-muted">{t("sync.working")}</p>
          )}
          {err && <p className="mt-3 text-sm text-down">{err}</p>}
        </div>
        <DeviceRow deviceId={deviceId} />
      </div>
    );
  }

  // ── Normal durum ──
  const statusLabel =
    sync?.status === "syncing"
      ? t("sync.statusSyncing")
      : sync?.status === "error"
      ? t("sync.statusError")
      : sync?.status === "idle"
      ? t("sync.statusIdle")
      : t("sync.statusOff");

  return (
    <div className="max-w-2xl">
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Cloud size={18} className="shrink-0 text-accent" />
            <span className="truncate text-sm font-medium">{userEmail}</span>
          </div>
          <button
            onClick={() => {
              stopSync();
              void signOut();
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-surface-2 px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
          >
            <LogOut size={14} />
            {t("sync.signOut")}
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm">
          {sync?.status === "syncing" ? (
            <RefreshCw size={14} className="animate-spin text-accent" />
          ) : sync?.status === "error" ? (
            <AlertTriangle size={14} className="text-down" />
          ) : (
            <Check size={14} className="text-up" />
          )}
          <span className={sync?.status === "error" ? "text-down" : "text-muted"}>
            {statusLabel}
          </span>
          {sync?.lastSyncAt ? (
            <span className="text-faint">
              · {t("sync.lastSync")} {fmtTime(sync.lastSyncAt)}
            </span>
          ) : null}
        </div>

        {sync?.lastError && (
          <p className="mt-2 break-words text-xs text-down">{sync.lastError}</p>
        )}

        <button
          disabled={sync?.status === "syncing"}
          onClick={() => void syncNow()}
          className="mt-4 flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-40"
        >
          <RefreshCw size={14} />
          {t("sync.syncNow")}
        </button>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-faint">
        {t("sync.whatSyncs")}
      </p>
      <DeviceRow deviceId={deviceId} />
    </div>
  );
}

function DeviceRow({ deviceId }: { deviceId: string }) {
  const t = useT();
  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="text-sm font-medium">{t("account.thisDevice")}</div>
      <div className="mt-1 font-mono text-xs text-faint">{deviceId}</div>
      <div className="mt-1 text-xs text-muted">{t("account.deviceDesc")}</div>
    </div>
  );
}
