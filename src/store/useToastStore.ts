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

interface ToastState {
  toasts: Toast[];
  show: (message: string, kind?: ToastKind, action?: ToastAction) => void;
  dismiss: (id: number) => void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (message, kind = "info", action) => {
    const id = ++counter;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind, action }] }));
    setTimeout(
      () => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },
      action ? 6000 : 4000 // aksiyon (ör. "Geri al") varsa biraz daha uzun dursun
    );
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
