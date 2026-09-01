import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StageEditor } from "@/components/recruitments/StageEditor";
import type { KanbanBoardStageDto } from "@/types";

function buildStage(overrides: Partial<KanbanBoardStageDto> = {}): KanbanBoardStageDto {
  return {
    id: 1,
    name: "New",
    sortOrder: 1,
    candidateCount: 0,
    candidates: [],
    ...overrides,
  };
}

function mockFetch(config: {
  putResponse?: { status: number; body: unknown };
  deleteResponse?: { status: number; body: unknown };
}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url === "/api/recruitments/1/stages" && init?.method === "PUT") {
      const { status, body } = config.putResponse ?? {
        status: 200,
        body: { stagesSource: "custom", stages: [{ id: 1, name: "New", sortOrder: 1 }] },
      };
      return new Response(JSON.stringify(body), { status });
    }

    if (url === "/api/recruitments/1/stages" && init?.method === "DELETE") {
      const { status, body } = config.deleteResponse ?? {
        status: 200,
        body: { stagesSource: "default", stages: [{ id: 1, name: "New", sortOrder: 1 }] },
      };
      return new Response(JSON.stringify(body), { status });
    }

    throw new Error(`Unexpected fetch call: ${url} ${init?.method ?? "GET"}`);
  });
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("stage-editor-trigger"));
  expect(await screen.findByTestId("stage-editor-dialog")).toBeInTheDocument();
}

describe("StageEditor", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("submits stages in the reordered array position after add/remove/reorder", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <StageEditor
        recruitmentId="1"
        stages={[buildStage({ id: 1, name: "New" }), buildStage({ id: 2, name: "Screening", sortOrder: 2 })]}
        stagesSource="default"
        onChanged={() => undefined}
      />,
    );

    await openEditor(user);

    // Add a third row and name it.
    await user.click(screen.getByRole("button", { name: /add stage/i }));
    await user.type(screen.getByLabelText("Stage 3 name"), "Offer");

    // Remove the first row ("New").
    await user.click(screen.getByRole("button", { name: "Remove stage 1" }));

    // Now rows are "Screening" (1), "Offer" (2). Move "Offer" up.
    await user.click(screen.getByRole("button", { name: "Move stage 2 up" }));

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recruitments/1/stages",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ stages: [{ name: "Offer" }, { name: "Screening" }] }),
        }),
      );
    });
  });

  it("renders a 422 field error against the correct row", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        putResponse: {
          status: 422,
          body: {
            error: {
              code: "invalid_request",
              message: "Invalid stage data",
              fields: { "stages.1.name": "Stage name is invalid" },
            },
          },
        },
      }),
    );
    const user = userEvent.setup();

    render(
      <StageEditor
        recruitmentId="1"
        stages={[buildStage({ id: 1, name: "New" }), buildStage({ id: 2, name: "Screening", sortOrder: 2 })]}
        stagesSource="default"
        onChanged={() => undefined}
      />,
    );

    await openEditor(user);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("Stage name is invalid")).toBeInTheDocument();
    const secondRowInput = screen.getByLabelText("Stage 2 name");
    expect(secondRowInput.closest("div")?.parentElement).toHaveTextContent("Stage name is invalid");
  });

  it("renders a clean message on a 403 denial", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        putResponse: {
          status: 403,
          body: { error: { code: "forbidden", message: "You are not allowed to edit this recruitment's stages" } },
        },
      }),
    );
    const user = userEvent.setup();

    render(
      <StageEditor recruitmentId="1" stages={[buildStage()]} stagesSource="default" onChanged={() => undefined} />,
    );

    await openEditor(user);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("You are not allowed to edit this recruitment's stages")).toBeInTheDocument();
  });

  it("renders read-only with an explanation when candidates already exist", async () => {
    const user = userEvent.setup();

    render(
      <StageEditor
        recruitmentId="1"
        stages={[buildStage({ candidateCount: 2 })]}
        stagesSource="default"
        onChanged={() => undefined}
      />,
    );

    await openEditor(user);

    expect(screen.getByTestId("stages-locked-message")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Stage 1 name")).not.toBeInTheDocument();
  });

  it("shows the reset action only when stagesSource is 'custom'", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    const user = userEvent.setup();

    render(
      <StageEditor recruitmentId="1" stages={[buildStage()]} stagesSource="default" onChanged={() => undefined} />,
    );
    await openEditor(user);
    expect(screen.queryByRole("button", { name: /reset to defaults/i })).not.toBeInTheDocument();

    cleanup();
    render(<StageEditor recruitmentId="1" stages={[buildStage()]} stagesSource="custom" onChanged={() => undefined} />);
    await openEditor(user);
    expect(screen.getByRole("button", { name: /reset to defaults/i })).toBeInTheDocument();
  });
});
