import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.__toastStore = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("toast-store", () => {
  it("notifies subscribers when a toast is added", async () => {
    const { subscribe, getSnapshot, toast } = await import("@/lib/toast-store");
    const listener = vi.fn();
    subscribe(listener);

    toast({ variant: "success", message: "Saved." });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSnapshot()).toHaveLength(1);
    expect(getSnapshot()[0]).toMatchObject({ variant: "success", message: "Saved." });
  });

  it("auto-dismisses a toast after the timeout", async () => {
    const { getSnapshot, toast } = await import("@/lib/toast-store");
    toast({ variant: "info", message: "FYI." });
    expect(getSnapshot()).toHaveLength(1);

    vi.runAllTimers();

    expect(getSnapshot()).toHaveLength(0);
  });

  it("dismisses a toast manually", async () => {
    const { getSnapshot, toast, dismiss } = await import("@/lib/toast-store");
    const id = toast({ variant: "error", message: "Oops." });
    expect(getSnapshot()).toHaveLength(1);

    dismiss(id);

    expect(getSnapshot()).toHaveLength(0);
  });

  it("shares the same singleton across repeat imports", async () => {
    const first = await import("@/lib/toast-store");
    first.toast({ variant: "success", message: "First." });

    const second = await import("@/lib/toast-store");

    expect(second.getSnapshot()).toHaveLength(1);
    expect(second.getSnapshot()[0].message).toBe("First.");
  });
});
