import { create } from "zustand";

export type ToastKind = "error" | "info" | "success";

export interface ToastAction {
  label: string;
  fn: () => void;
}

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

/** Kalıcı hata kaydı (Ayarlar → Sorun Giderme'de listelenir). */
export interface ProblemEntry {
  at: number;
  message: string;
  count: number;
}

interface ToastState {
  toasts: Toast[];
  /**
   * ⭐ SON SORUNLAR (v1.8.3): toast 4 saniye sonra kaybolur; tekrar eden bir
   * hata (ör. her şarkıda indirme hatası) hiçbir yerde iz bırakmıyordu ve
   * arayüzde log ekranı yok. Aynı metin tekrar gelirse yeni satır açmak yerine
   * sayaç artar — 20 kere "indirilemedi" görmek yerine "×20" görürsün.
   */
  problems: ProblemEntry[];
  show: (message: string, kind?: ToastKind, action?: ToastAction) => void;
  dismiss: (id: number) => void;
  clearProblems: () => void;
}

let counter = 0;

const MAX_PROBLEMS = 20;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  problems: [],
  show: (message, kind = "info", action) => {
    const id = ++counter;
    set((s) => {
      const next: Partial<ToastState> = {
        toasts: [...s.toasts, { id, message, kind, action }],
      };
      if (kind === "error") {
        const list = [...s.problems];
        const same = list.find((p) => p.message === message);
        if (same) {
          same.count += 1;
          same.at = Date.now();
        } else {
          list.unshift({ at: Date.now(), message, count: 1 });
        }
        next.problems = list.slice(0, MAX_PROBLEMS);
      }
      return next as ToastState;
    });
    setTimeout(
      () => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },
      action ? 6000 : 4000 // aksiyon (ör. "Geri al") varsa biraz daha uzun dursun
    );
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clearProblems: () => set({ problems: [] }),
}));
