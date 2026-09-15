import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditRecruitmentDialog } from "@/components/recruitments/EditRecruitmentDialog";
import { RECRUITMENT_DETAILS_CHANGED_EVENT } from "@/lib/recruitment-details-events";
import type { RecruitmentDetailDto } from "@/types";

const RECRUITMENT: RecruitmentDetailDto = {
  id: 1,
  title: "Backend Engineer",
  status: "draft",
  department: "Engineering",
  location: "Remote",
  employmentType: "full-time",
  openedAt: "2026-01-01",
};

function mockFetch(config: { patchResponse?: { status: number; body: unknown } }) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url === "/api/recruitments/1" && init?.method === "PATCH") {
      const { status, body } = config.patchResponse ?? { status: 200, body: RECRUITMENT };
      return new Response(JSON.stringify(body), { status });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EditRecruitmentDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch({}));
  });

  it("blocks submit on an empty title without calling fetch", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <EditRecruitmentDialog recruitment={RECRUITMENT} open onOpenChange={() => undefined} onSaved={() => undefined} />,
    );

    await user.clear(screen.getByLabelText("Title", { exact: false }));
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText("Title is required")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders a server field error", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        patchResponse: {
          status: 422,
          body: {
            error: {
              code: "invalid_request",
              message: "Invalid request",
              fields: { title: "Title must be 200 characters or fewer" },
            },
          },
        },
      }),
    );
    const user = userEvent.setup();
    render(
      <EditRecruitmentDialog recruitment={RECRUITMENT} open onOpenChange={() => undefined} onSaved={() => undefined} />,
    );

    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText("Title must be 200 characters or fewer")).toBeInTheDocument();
  });

  it("dispatches the details-changed event and calls onSaved on success", async () => {
    const updated = { ...RECRUITMENT, title: "Senior Backend Engineer" };
    vi.stubGlobal("fetch", mockFetch({ patchResponse: { status: 200, body: updated } }));
    const onSaved = vi.fn();
    const listener = vi.fn();
    window.addEventListener(RECRUITMENT_DETAILS_CHANGED_EVENT, listener);

    const user = userEvent.setup();
    render(<EditRecruitmentDialog recruitment={RECRUITMENT} open onOpenChange={() => undefined} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(updated);
    });
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(RECRUITMENT_DETAILS_CHANGED_EVENT, listener);
  });
});
