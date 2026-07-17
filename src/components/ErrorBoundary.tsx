import { Component, type ReactNode } from "react";
// Class component → hook kullanılamaz; React-dışı t() store'dan dili okur.
import { t } from "../lib/i18n";
import Logo from "./Logo";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

// Arayüzde beklenmedik bir render hatası olursa beyaz ekran yerine kurtarma
// ekranı gösterir (uygulama tamamen çökmesin).
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[resonance] arayüz hatası:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-center text-text">
          <div className="grid h-12 w-12 place-items-center rounded-md bg-accent/15 text-accent">
            <Logo className="h-7 w-7" />
          </div>
          <h1 className="text-lg font-semibold">{t("error.title")}</h1>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            {t("error.body")}
          </p>
          <pre className="max-w-lg overflow-auto rounded-md border border-border bg-surface px-3 py-2 text-left text-xs text-faint">
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg"
          >
            {t("error.retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
