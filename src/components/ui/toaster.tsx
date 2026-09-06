import { useSyncExternalStore } from "react";
import { X, CircleCheck, CircleAlert, Info } from "lucide-react";
import { subscribe, getSnapshot, dismiss, type ToastVariant } from "@/lib/toast-store";
import { cn } from "@/lib/utils";

const variantStyles: Record<ToastVariant, string> = {
  success: "border-success/30 bg-success text-success-foreground",
  error: "border-destructive/30 bg-destructive text-white",
  info: "border-info/30 bg-info text-info-foreground",
};

const variantIcon: Record<ToastVariant, typeof CircleCheck> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
};

function renderToast(t: ReturnType<typeof getSnapshot>[number]) {
  const Icon = variantIcon[t.variant];
  return (
    <div
      key={t.id}
      className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg", variantStyles[t.variant])}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1">{t.message}</span>
      <button
        type="button"
        onClick={() => {
          dismiss(t.id);
        }}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-sm opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, () => []);
  const errorToasts = toasts.filter((t) => t.variant === "error");
  const politeToasts = toasts.filter((t) => t.variant !== "error");

  return (
    <div className="fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2">
      <div aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
        {politeToasts.map(renderToast)}
      </div>
      <div aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2">
        {errorToasts.map(renderToast)}
      </div>
    </div>
  );
}
