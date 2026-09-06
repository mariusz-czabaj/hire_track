import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { KanbanBoard } from "@/components/recruitments/KanbanBoard";
import type { KanbanBoardDto } from "@/types";

function buildBoard(overrides: Partial<KanbanBoardDto> = {}): KanbanBoardDto {
  return {
    recruitment: { id: 1, title: "Backend Engineer", status: "live" },
    stagesSource: "default",
    stages: [
      { id: 1, name: "New", sortOrder: 0, candidateCount: 1, candidates: [] },
      { id: 2, name: "Screening", sortOrder: 1, candidateCount: 0, candidates: [] },
    ],
    ...overrides,
  };
}

function mockFetch(board: KanbanBoardDto) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(board), { status: 200 })));
}

describe("KanbanBoard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders each column as an accessible region named by its stage", async () => {
    vi.stubGlobal("fetch", mockFetch(buildBoard()));
    render(<KanbanBoard recruitmentId="1" />);

    await waitFor(() => expect(screen.getByTestId("kanban-columns")).toBeInTheDocument());

    const newRegion = screen.getByRole("region", { name: "New" });
    const screeningRegion = screen.getByRole("region", { name: "Screening" });
    expect(newRegion).toBeInTheDocument();
    expect(screeningRegion).toBeInTheDocument();
  });

  it("renders a zero-candidate stage as a column with the 'No candidates' text", async () => {
    vi.stubGlobal("fetch", mockFetch(buildBoard()));
    render(<KanbanBoard recruitmentId="1" />);

    await waitFor(() => expect(screen.getByTestId("kanban-columns")).toBeInTheDocument());

    const screeningRegion = screen.getByRole("region", { name: "Screening" });
    expect(screeningRegion).toHaveTextContent("No candidates");
  });

  it("renders the added date as a single node matching the expected format", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        buildBoard({
          stages: [
            {
              id: 1,
              name: "New",
              sortOrder: 0,
              candidateCount: 1,
              candidates: [{ id: 1, fullName: "Ada Lovelace", addedAt: "2026-01-15", candidateRecruitmentId: 1 }],
            },
          ],
        }),
      ),
    );
    render(<KanbanBoard recruitmentId="1" />);

    expect(await screen.findByText(/^Added \d{4}-\d{2}-\d{2}$/)).toBeInTheDocument();
  });

  it("numbers move-candidate trigger labels board-wide across stages", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        buildBoard({
          stages: [
            {
              id: 1,
              name: "New",
              sortOrder: 0,
              candidateCount: 1,
              candidates: [{ id: 1, fullName: "Ada Lovelace", addedAt: "2026-01-15", candidateRecruitmentId: 1 }],
            },
            {
              id: 2,
              name: "Screening",
              sortOrder: 1,
              candidateCount: 1,
              candidates: [{ id: 2, fullName: "Grace Hopper", addedAt: "2026-01-16", candidateRecruitmentId: 2 }],
            },
          ],
        }),
      ),
    );
    render(<KanbanBoard recruitmentId="1" />);

    expect(await screen.findByRole("button", { name: "Move candidate 1: Ada Lovelace" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Move candidate 2: Grace Hopper" })).toBeInTheDocument();
  });

  it("renders columns in sortOrder order as direct children of the kanban-columns element", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        buildBoard({
          stages: [
            { id: 2, name: "Screening", sortOrder: 1, candidateCount: 0, candidates: [] },
            { id: 1, name: "New", sortOrder: 0, candidateCount: 0, candidates: [] },
          ],
        }),
      ),
    );
    render(<KanbanBoard recruitmentId="1" />);

    await waitFor(() => expect(screen.getByTestId("kanban-columns")).toBeInTheDocument());

    const container = screen.getByTestId("kanban-columns");
    const children = Array.from(container.children);
    expect(children).toHaveLength(2);
    expect(children[0]).toHaveTextContent("Screening");
    expect(children[1]).toHaveTextContent("New");
  });
});
