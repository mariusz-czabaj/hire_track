export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: string;
  variant: ToastVariant;
  message: string;
}

interface ToastStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Toast[];
  toast: (input: { variant: ToastVariant; message: string }) => string;
  dismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 4000;

declare global {
  var __toastStore: ToastStore | undefined;
}

function createToastStore(): ToastStore {
  let toasts: Toast[] = [];
  const listeners = new Set<() => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function notify() {
    for (const listener of listeners) listener();
  }

  function dismiss(id: string) {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    if (!toasts.some((t) => t.id === id)) return;
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }

  function toast({ variant, message }: { variant: ToastVariant; message: string }): string {
    const id = crypto.randomUUID();
    toasts = [...toasts, { id, variant, message }];
    notify();
    timers.set(
      id,
      setTimeout(() => {
        dismiss(id);
      }, AUTO_DISMISS_MS),
    );
    return id;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return toasts;
    },
    toast,
    dismiss,
  };
}

function getToastStore(): ToastStore {
  if (typeof globalThis === "undefined") {
    return createToastStore();
  }
  globalThis.__toastStore ??= createToastStore();
  return globalThis.__toastStore;
}

const store = getToastStore();

export const subscribe = store.subscribe;
export const getSnapshot = store.getSnapshot;
export const toast = store.toast;
export const dismiss = store.dismiss;
