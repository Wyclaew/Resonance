import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "@fontsource-variable/inter";
import "@fontsource-variable/archivo";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import { restoreDurableStorage } from "./lib/durableStorage";

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
