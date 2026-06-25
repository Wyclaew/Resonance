import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";

// Global hata yakalayıcılar — yakalanmayan hata/promise'leri logla
// (uygulamayı çökertmeden görünür kılar).
window.addEventListener("error", (e) => {
  console.error("[resonance] yakalanmamış hata:", e.error ?? e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[resonance] yakalanmamış promise reddi:", e.reason);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
