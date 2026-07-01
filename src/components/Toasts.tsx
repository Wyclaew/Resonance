import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useToastStore, type ToastKind } from "../store/useToastStore";

const ICONS: Record<ToastKind, React.ReactNode> = {
  error: <AlertCircle size={16} className="text-down" />,
  success: <CheckCircle2 size={16} className="text-up" />,
  info: <Info size={16} className="text-accent" />,
};

export default function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-sm shadow-2xl"
        >
          {ICONS[t.kind]}
          <span className="text-text">{t.message}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action?.fn();
                dismiss(t.id);
              }}
              className="ml-1 shrink-0 rounded-md bg-surface-3 px-2 py-1 text-xs font-medium text-accent hover:bg-surface"
            >
              {t.action.label}
            </button>
          )}
          <button
            onClick={() => dismiss(t.id)}
            className="ml-1 text-faint hover:text-text"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
