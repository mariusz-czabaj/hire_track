import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoveCandidateDialog } from "@/components/recruitments/MoveCandidateDialog";
import type { KanbanBoardStageDto } from "@/types";

const STAGES: KanbanBoardStageDto[] = [
  { id: 10, name: "New", sortOrder: 1, candidateCount: 1, candidates: [] },
  { id: 20, name: "Screening", sortOrder: 2, candidateCount: 0, candidates: [] },
];

const CANDIDATE_URL = "/api/recruitments/1/candidates/5";

function mockFetch(config: {
  detailResponse?: { status: number; body: unknown };
  patchResponse?: { status: number; body: unknown };
}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url === CANDIDATE_URL && (init?.method === undefined || init.method === "GET")) {
      const { status, body } = config.detailResponse ?? {
        status: 200,
        body: {
          id: 5,
          candidateId: 42,
          fullName: "Ada Lovelace",
          email: "ada@example.com",
          phone: null,
          addedAt: "2026-01-02",
          currentStageId: 10,
          notes: [
            { stageId: 10, stageName: "New", body: null, authorEmail: null, createdAt: null, updatedAt: null },
            { stageId: 20, stageName: "Screening", body: null, authorEmail: null, createdAt: null, updatedAt: null },
          ],
        },
      };
      return new Response(JSON.stringify(body), { status });
    }

    if (url === CANDIDATE_URL && init?.method === "PATCH") {
      const { status, body } = config.patchResponse ?? { status: 200, body: { id: 5, currentStageId: 20 } };
      return new Response(JSON.stringify(body), { status });
    }

    throw new Error(`Unexpected fetch call: ${url} ${init?.method ?? "GET"}`);
  });
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Move candidate 1: Ada Lovelace" }));
  expect(await screen.findByLabelText("Target stage")).toBeInTheDocument();
}

describe("MoveCandidateDialog", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("seeds the target stage and note from the candidate detail, then submits an exact serialized payload", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const onChanged = vi.fn();

    render(
      <MoveCandidateDialog
        recruitmentId="1"
        candidateRecruitmentId={5}
        triggerLabel="Move candidate 1: Ada Lovelace"
        stages={STAGES}
        onChanged={onChanged}
      />,
    );

    await openDialog(user);

    expect(screen.getByLabelText("Target stage")).toHaveValue("10");
    expect(screen.getByLabelText("Note for the stage being left")).toHaveValue("");

    await user.selectOptions(screen.getByLabelText("Target stage"), "20");
    await user.type(screen.getByLabelText("Note for the stage being left"), "Strong technical screen.");
    await user.click(screen.getByRole("button", { name: /^move$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        CANDIDATE_URL,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ toStageId: 20, note: "Strong technical screen." }),
        }),
      );
    });
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it("renders a note_required 422 as a field error on the note textarea", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        patchResponse: {
          status: 422,
          body: {
            error: {
              code: "note_required",
              message: "A note for the stage being left is required before moving",
              fields: { note: "A note for the stage being left is required before moving" },
            },
          },
        },
      }),
    );
    const user = userEvent.setup();

    render(
      <MoveCandidateDialog
        recruitmentId="1"
        candidateRecruitmentId={5}
        triggerLabel="Move candidate 1: Ada Lovelace"
        stages={STAGES}
        onChanged={() => undefined}
      />,
    );

    await openDialog(user);
    await user.selectOptions(screen.getByLabelText("Target stage"), "20");
    await user.click(screen.getByRole("button", { name: /^move$/i }));

    expect(await screen.findByText("A note for the stage being left is required before moving")).toBeInTheDocument();
    const noteField = screen.getByLabelText("Note for the stage being left");
    expect(noteField.closest("div")).toHaveTextContent("A note for the stage being left is required before moving");
  });

  it("renders a clean message on a 403 denial", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        patchResponse: {
          status: 403,
          body: { error: { code: "forbidden", message: "You are not allowed to perform this action" } },
        },
      }),
    );
    const user = userEvent.setup();

    render(
      <MoveCandidateDialog
        recruitmentId="1"
        candidateRecruitmentId={5}
        triggerLabel="Move candidate 1: Ada Lovelace"
        stages={STAGES}
        onChanged={() => undefined}
      />,
    );

    await openDialog(user);
    await user.selectOptions(screen.getByLabelText("Target stage"), "20");
    await user.type(screen.getByLabelText("Note for the stage being left"), "Note.");
    await user.click(screen.getByRole("button", { name: /^move$/i }));

    expect(await screen.findByText("You are not allowed to perform this action")).toBeInTheDocument();
  });
});
