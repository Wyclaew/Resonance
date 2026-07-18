import { useState } from "react";
import { Minus, Square, X, Copy } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/db";
import { useT } from "../lib/i18n";

// Windows için özel pencere kontrolleri (min / maks / kapat).
//
// NEDEN: Windows'ta `decorations:false` (lib.rs, yalnız Windows) başlık çubuğunu
// ve OS'un min/maks/kapat butonlarını kaldırır → bunları biz çizmeliyiz.
// macOS'ta HİÇ render edilmez (trafik ışıkları zaten var; isWindows kontrolü).
//
// GÜVENLİK: kapat butonu bir şekilde çalışmazsa Alt+F4 (OS seviyesi,
// dekorasyonsuz da geçerli) yine kapatır — pencere asla kilitlenmez.

const isWindows =
  typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

export default function WindowControls() {
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  // Yalnız Windows + Tauri içinde. Diğer her yerde görünmez.
  if (!isWindows || !isTauri()) return null;

  const win = getCurrentWindow();

  return (
    <div className="flex h-full items-stretch" data-tauri-drag-region={false}>
      <button
        onClick={() => win.minimize().catch(() => {})}
        title={t("win.minimize")}
        className="grid w-11 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
      >
        <Minus size={15} />
      </button>
      <button
        onClick={async () => {
          try {
            await win.toggleMaximize();
            setMaximized(await win.isMaximized());
          } catch {
            /* yoksay */
          }
        }}
        title={maximized ? t("win.restore") : t("win.maximize")}
        className="grid w-11 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-text"
      >
        {maximized ? <Copy size={13} /> : <Square size={12} />}
      </button>
      <button
        onClick={() => win.close().catch(() => {})}
        title={t("win.close")}
        className="grid w-11 place-items-center text-muted transition-colors hover:bg-down hover:text-white"
      >
        <X size={16} />
      </button>
    </div>
  );
}
