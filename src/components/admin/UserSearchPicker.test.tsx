import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserSearchPicker } from "@/components/admin/UserSearchPicker";
import type { UserSearchResultDto } from "@/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPicker(
  overrides: {
    existingUserIds?: string[];
    onAdd?: (user: UserSearchResultDto) => Promise<void>;
  } = {},
) {
  const onAdd = overrides.onAdd ?? vi.fn().mockResolvedValue(undefined);
  render(<UserSearchPicker existingUserIds={overrides.existingUserIds ?? []} onAdd={onAdd} />);
  return { onAdd };
}

describe("UserSearchPicker", () => {
  // Oracle: the plan's Phase 4 contract -- "distinct below-minimum, loading,
  // empty-result, and error states", and a minimum query length that mirrors
  // the search RPC's own inert-on-short-term behaviour.
  it("shows the below-minimum hint before enough characters are typed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderPicker();

    expect(screen.getByText(/type at least 2 characters/i)).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/search users/i), "a");

    // Below the minimum the component must not call the API at all.
    await waitFor(() => {
      expect(screen.getByText(/type at least 2 characters/i)).toBeInTheDocument();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders matching users once a valid term resolves", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: "u-1", email: "hr.test@example.com" }]), { status: 200 }),
    );
    renderPicker();

    await userEvent.type(screen.getByPlaceholderText(/search users/i), "hr");

    expect(await screen.findByText("hr.test@example.com")).toBeInTheDocument();
  });

  it("shows the empty-result state distinctly from the below-minimum state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    renderPicker();

    await userEvent.type(screen.getByPlaceholderText(/search users/i), "zzz");

    expect(await screen.findByText(/no matching users found/i)).toBeInTheDocument();
    expect(screen.queryByText(/type at least 2 characters/i)).not.toBeInTheDocument();
  });

  it("shows an error state when the search request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 403 }));
    renderPicker();

    await userEvent.type(screen.getByPlaceholderText(/search users/i), "hr");

    expect(await screen.findByText(/failed to search users/i)).toBeInTheDocument();
  });

  it("shows an error state when the request throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    renderPicker();

    await userEvent.type(screen.getByPlaceholderText(/search users/i), "hr");

    expect(await screen.findByText(/failed to search users/i)).toBeInTheDocument();
  });

  it("offers no Add control for a user already in the group", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: "u-1", email: "hr.test@example.com" }]), { status: 200 }),
    );
    renderPicker({ existingUserIds: ["u-1"] });

    await userEvent.type(screen.getByPlaceholderText(/search users/i), "hr");

    expect(await screen.findByText(/already a member/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
  });

  it("hands the selected user to onAdd", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: "u-1", email: "hr.test@example.com" }]), { status: 200 }),
    );
    const { onAdd } = renderPicker();

    await userEvent.type(screen.getByPlaceholderText(/search users/i), "hr");
    await userEvent.click(await screen.findByRole("button", { name: /add/i }));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith({ id: "u-1", email: "hr.test@example.com" });
    });
  });

  // Regression for the stale-response bug found in implementation review: a
  // shared ignore ref was reset at the top of each effect run, so a slow
  // response for an older query could overwrite a newer query's results.
  it("does not let a slow earlier query overwrite the latest results", async () => {
    // The first query must still be in flight when the second one resolves,
    // so it is deliberately slower than the 300ms debounce plus the gap below.
    const responses: Record<string, { delay: number; body: UserSearchResultDto[] }> = {
      an: { delay: 800, body: [{ id: "u-old", email: "stale@example.com" }] },
      anna: { delay: 0, body: [{ id: "u-new", email: "fresh@example.com" }] },
    };

    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const term = new URL(url, "http://localhost").searchParams.get("q") ?? "";
      const match = responses[term] ?? { delay: 0, body: [] };
      // Honour the abort signal the way a real fetch does, so the component's
      // cancellation is exercised rather than assumed.
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(new Response(JSON.stringify(match.body), { status: 200 }));
        }, match.delay);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    renderPicker();
    const input = screen.getByPlaceholderText(/search users/i);

    await userEvent.type(input, "an");
    // Let the debounce elapse so the "an" request actually goes out and is
    // still pending when the next one is issued -- without this wait the
    // debounce collapses both keystrokes into a single request and there is
    // no race to observe.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await userEvent.type(input, "na");

    expect(await screen.findByText("fresh@example.com")).toBeInTheDocument();

    // Give the slower, older request time to settle; it must be ignored.
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(screen.queryByText("stale@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("fresh@example.com")).toBeInTheDocument();
  });
});
