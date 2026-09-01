import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddCandidateDialog } from "@/components/recruitments/AddCandidateDialog";

function mockFetch(config: { postResponse?: { status: number; body: unknown } }) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url === "/api/recruitments/1/candidates" && init?.method === "POST") {
      const { status, body } = config.postResponse ?? {
        status: 201,
        body: { id: 42, fullName: "Ada Lovelace", addedAt: "2026-01-02", candidateRecruitmentId: 5 },
      };
      return new Response(JSON.stringify(body), { status });
    }

    throw new Error(`Unexpected fetch call: ${url} ${init?.method ?? "GET"}`);
  });
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("add-candidate-trigger"));
  expect(await screen.findByTestId("add-candidate-dialog")).toBeInTheDocument();
}

describe("AddCandidateDialog", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("submits the exact serialized payload on the happy path", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const onChanged = vi.fn();

    render(<AddCandidateDialog recruitmentId="1" onChanged={onChanged} />);
    await openDialog(user);

    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Phone (optional)"), "+48 600 100 100");
    await user.click(screen.getByRole("button", { name: /^add candidate$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recruitments/1/candidates",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ fullName: "Ada Lovelace", email: "ada@example.com", phone: "+48 600 100 100" }),
        }),
      );
    });
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it("omits phone from the payload when left blank", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AddCandidateDialog recruitmentId="1" onChanged={() => undefined} />);
    await openDialog(user);

    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: /^add candidate$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recruitments/1/candidates",
        expect.objectContaining({
          body: JSON.stringify({ fullName: "Ada Lovelace", email: "ada@example.com" }),
        }),
      );
    });
  });

  it("renders a candidate_name_mismatch 422 as a field error on the name input", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        postResponse: {
          status: 422,
          body: {
            error: {
              code: "candidate_name_mismatch",
              message: 'A candidate with email ada@example.com already exists as "Ada Byron"',
              fields: { fullName: 'A candidate with email ada@example.com already exists as "Ada Byron"' },
            },
          },
        },
      }),
    );
    const user = userEvent.setup();

    render(<AddCandidateDialog recruitmentId="1" onChanged={() => undefined} />);
    await openDialog(user);

    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: /^add candidate$/i }));

    expect(
      await screen.findByText('A candidate with email ada@example.com already exists as "Ada Byron"'),
    ).toBeInTheDocument();
    const nameInput = screen.getByLabelText("Full name");
    expect(nameInput.closest("div")?.parentElement).toHaveTextContent("already exists as");
  });

  it("renders a clean message on a 403 denial", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        postResponse: {
          status: 403,
          body: { error: { code: "forbidden", message: "You are not allowed to perform this action" } },
        },
      }),
    );
    const user = userEvent.setup();

    render(<AddCandidateDialog recruitmentId="1" onChanged={() => undefined} />);
    await openDialog(user);

    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: /^add candidate$/i }));

    expect(await screen.findByText("You are not allowed to perform this action")).toBeInTheDocument();
  });

  it("blocks submission client-side when required fields are empty", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AddCandidateDialog recruitmentId="1" onChanged={() => undefined} />);
    await openDialog(user);

    await user.click(screen.getByRole("button", { name: /^add candidate$/i }));

    expect(await screen.findByText("Full name is required")).toBeInTheDocument();
    expect(screen.getByText("Email is required")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
