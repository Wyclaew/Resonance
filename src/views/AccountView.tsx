import ViewHeader from "../components/ViewHeader";
import SyncSettings from "../components/SyncSettings";
import { useT } from "../lib/i18n";

// Hesap & senkron — artık Ayarlar'ın bir sekmesi DEĞİL, profil menüsünden
// açılan kendi sayfası. Ayarlar teknik tercihler için kaldı; hesap işleri
// (giriş, senkron, çıkış) profilin altında toplandı.

export default function AccountView() {
  const t = useT();
  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={t("profile.account")} subtitle={t("sync.signInBody")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        <SyncSettings />
      </div>
    </div>
  );
}
