import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateRecruitmentForm } from "@/components/recruitments/CreateRecruitmentForm";

const SECURITY_GROUPS = [
  { id: 1, name: "HR Recruiter" },
  { id: 2, name: "Hiring Manager" },
];

function mockFetch(config: { createResponse?: { status: number; body: unknown } }) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url === "/api/security-groups") {
      return new Response(JSON.stringify(SECURITY_GROUPS), { status: 200 });
    }

    if (url === "/api/recruitments" && init?.method === "POST") {
      const { status, body } = config.createResponse ?? { status: 201, body: { id: 1 } };
      return new Response(JSON.stringify(body), { status });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  });
}

async function fillValidFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Title"), "Backend Engineer");
  await user.type(screen.getByLabelText("Department"), "Engineering");
  await user.type(screen.getByLabelText("Location"), "Remote");
  const dateInput = screen.getByLabelText("Opened date");
  await user.clear(dateInput);
  await user.type(dateInput, "2026-01-01");
}

describe("CreateRecruitmentForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch({}));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows required-field errors and blocks submission when fields are empty", async () => {
    const user = userEvent.setup();
    render(<CreateRecruitmentForm />);

    await user.click(screen.getByRole("button", { name: /create recruitment/i }));

    expect(await screen.findByText("Title is required")).toBeInTheDocument();
    expect(screen.getByText("Department is required")).toBeInTheDocument();
    expect(screen.getByText("Location is required")).toBeInTheDocument();
    expect(screen.getByText("Opened date is required")).toBeInTheDocument();
    expect(screen.getByText("Select at least one security group")).toBeInTheDocument();
  });

  it("clears a field's error as soon as the user types into it", async () => {
    const user = userEvent.setup();
    render(<CreateRecruitmentForm />);

    await user.click(screen.getByRole("button", { name: /create recruitment/i }));
    expect(await screen.findByText("Title is required")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Title"), "B");
    expect(screen.queryByText("Title is required")).not.toBeInTheDocument();
  });

  it("blocks submission client-side when no security group is selected, without calling the API", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CreateRecruitmentForm />);

    await fillValidFields(user);
    await waitFor(() => {
      expect(screen.getByText("HR Recruiter")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /create recruitment/i }));

    expect(await screen.findByText("Select at least one security group")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/recruitments", expect.anything());
  });

  it("renders a server error message on a 403 denial", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        createResponse: {
          status: 403,
          body: { error: { code: "forbidden", message: "You are not allowed to create a recruitment" } },
        },
      }),
    );
    const user = userEvent.setup();
    render(<CreateRecruitmentForm />);

    await fillValidFields(user);
    await waitFor(() => {
      expect(screen.getByText("HR Recruiter")).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText("HR Recruiter"));

    await user.click(screen.getByRole("button", { name: /create recruitment/i }));

    expect(await screen.findByText("You are not allowed to create a recruitment")).toBeInTheDocument();
  });
});
