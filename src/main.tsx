import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "@fontsource-variable/inter";
import "@fontsource-variable/archivo";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import { restoreDurableStorage } from "./lib/durableStorage";
import { invoke } from "@tauri-apps/api/core";

// ⭐ ÖNEMLİ KONSOL HATALARI LOG DOSYASINA (v1.9.3): senkron ve uygulama
// hataları yalnız webview konsolunda kalıyordu → kullanıcının makinesinde
// (özellikle Windows'ta) "liste eksik" gibi sorunlar teşhis edilemiyordu.
// Yalnız "[sync]" / "[resonance]" önekli uyarı ve hatalar; dakikada en çok 40.
if ("__TAURI_INTERNALS__" in window) {
  let windowStart = Date.now();
  let sent = 0;
  const forward = (level: "warn" | "error", args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (!first.startsWith("[sync]") && !first.startsWith("[resonance]")) return;
    const now = Date.now();
    if (now - windowStart > 60_000) {
      windowStart = now;
      sent = 0;
    }
    if (++sent > 40) return;
    const message = args
      .map((a) =>
        a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : safeJson(a)
      )
      .join(" ");
    void invoke("log_from_js", { level, message }).catch(() => {});
  };
  const safeJson = (v: unknown) => {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  for (const level of ["warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      forward(level, args);
    };
  }
}

// Global hata yakalayıcılar — yakalanmayan hata/promise'leri logla
// (uygulamayı çökertmeden görünür kılar).
window.addEventListener("error", (e) => {
  console.error("[resonance] yakalanmamış hata:", e.error ?? e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[resonance] yakalanmamış promise reddi:", e.reason);
});

// Cihaz kimliği + oturum, uygulama bunları okumadan ÖNCE diskten geri gelsin.
void restoreDurableStorage().finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
});
