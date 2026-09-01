import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CandidateDetail } from "@/components/recruitments/CandidateDetail";
import type { CandidateDetailDto } from "@/types";

const DETAIL_URL = "/api/recruitments/1/candidates/5";

function buildDetail(overrides: Partial<CandidateDetailDto> = {}): CandidateDetailDto {
  return {
    id: 5,
    candidateId: 42,
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+48 600 100 100",
    addedAt: "2026-01-02",
    currentStageId: 10,
    notes: [
      {
        stageId: 10,
        stageName: "New",
        body: "Great first impression.",
        authorEmail: "hr.test@example.com",
        createdAt: "2026-01-02T10:00:00Z",
        updatedAt: "2026-01-02T10:00:00Z",
      },
      { stageId: 20, stageName: "Screening", body: null, authorEmail: null, createdAt: null, updatedAt: null },
    ],
    ...overrides,
  };
}

function mockFetch(config: {
  detailResponse?: { status: number; body: unknown };
  putResponse?: { status: number; body: unknown };
}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url === DETAIL_URL && (init?.method === undefined || init.method === "GET")) {
      const { status, body } = config.detailResponse ?? { status: 200, body: buildDetail() };
      return new Response(JSON.stringify(body), { status });
    }

    if (url === `${DETAIL_URL}/notes` && init?.method === "PUT") {
      const { status, body } = config.putResponse ?? {
        status: 200,
        body: {
          stageId: 10,
          stageName: "New",
          body: "Updated note.",
          authorEmail: "hr.test@example.com",
          createdAt: "2026-01-02T10:00:00Z",
          updatedAt: "2026-01-03T10:00:00Z",
        },
      };
      return new Response(JSON.stringify(body), { status });
    }

    throw new Error(`Unexpected fetch call: ${url} ${init?.method ?? "GET"}`);
  });
}

describe("CandidateDetail", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists every resolved stage in order, with an empty-state line for stages with no note", async () => {
    vi.stubGlobal("fetch", mockFetch({}));

    render(<CandidateDetail recruitmentId="1" candidateRecruitmentId="5" />);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();

    const newNote = screen.getByTestId("note-10");
    expect(newNote).toHaveTextContent("New");
    expect(newNote).toHaveTextContent("Great first impression.");
    expect(newNote).toHaveTextContent("hr.test@example.com");

    const screeningNote = screen.getByTestId("note-20");
    expect(screeningNote).toHaveTextContent("Screening");
    expect(screeningNote).toHaveTextContent("No note yet");
  });

  it("sends the exact PUT body on a successful edit and refetches", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CandidateDetail recruitmentId="1" candidateRecruitmentId="5" />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Edit note for New" }));
    await user.clear(screen.getByLabelText("Note for New"));
    await user.type(screen.getByLabelText("Note for New"), "Updated note.");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${DETAIL_URL}/notes`,
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ stageId: 10, body: "Updated note." }),
        }),
      );
    });

    // Refetch after the mutation -- GET called at least twice (initial load + after save).
    await waitFor(() => {
      const getCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === undefined || init.method === "GET");
      expect(getCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("renders a clean message on a 403 denial", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        putResponse: {
          status: 403,
          body: { error: { code: "forbidden", message: "You are not allowed to perform this action" } },
        },
      }),
    );
    const user = userEvent.setup();

    render(<CandidateDetail recruitmentId="1" candidateRecruitmentId="5" />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Edit note for New" }));
    await user.type(screen.getByLabelText("Note for New"), " Attempt.");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("You are not allowed to perform this action")).toBeInTheDocument();
  });

  it("renders the not-found state for a missing candidate", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        detailResponse: { status: 404, body: { error: { code: "not_found", message: "Candidate not found" } } },
      }),
    );

    render(<CandidateDetail recruitmentId="1" candidateRecruitmentId="5" />);

    expect(await screen.findByText("This candidate could not be found.")).toBeInTheDocument();
  });
});
