import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SecurityGroupDetail } from "@/components/admin/SecurityGroupDetail";
import type { SecurityGroupDetailDto } from "@/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DETAIL: SecurityGroupDetailDto = {
  id: 1,
  name: "HR Recruiter",
  operations: ["recruitment.read"],
  members: [{ userId: "u-1", email: "hr.test@example.com" }],
};

function checkbox(label: RegExp) {
  return screen.getByRole("checkbox", { name: label });
}

/**
 * Serves the group detail, then routes operation writes to the supplied
 * handler. Anything else 500s loudly so an unexpected call is visible.
 */
function mockFetch(onOperationWrite: (method: string, operation: string) => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";

    if (url === "/api/security-groups/1" && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify(DETAIL), { status: 200 }));
    }
    if (url === "/api/security-groups/1/operations") {
      const { operation } = JSON.parse(init?.body as string) as { operation: string };
      return onOperationWrite(method, operation);
    }
    return Promise.resolve(new Response("{}", { status: 500 }));
  });
}

async function renderDetail() {
  render(<SecurityGroupDetail groupId="1" />);
  expect(await screen.findByDisplayValue("HR Recruiter")).toBeInTheDocument();
}

describe("SecurityGroupDetail operation toggles", () => {
  // Oracle: the plan's Phase 4 contract -- each checkbox "writes immediately
  // on toggle and reconciles from the response, disabled while in flight and
  // reverted on error".
  it("reconciles the checkbox set from the write response", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ operations: ["recruitment.read", "candidate.read"] }), { status: 200 }),
      ),
    );
    await renderDetail();

    await userEvent.click(checkbox(/view candidates/i));

    await waitFor(() => {
      expect(checkbox(/view candidates/i)).toBeChecked();
    });
    // Reconciliation is from the response body, not from local optimism.
    expect(checkbox(/view recruitments/i)).toBeChecked();
  });

  it("reverts the checkbox when the write is refused", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: "last_admin_required", message: "At least one administrator must remain" } }),
          { status: 422 },
        ),
      ),
    );
    await renderDetail();

    expect(checkbox(/manage security groups/i)).not.toBeChecked();
    await userEvent.click(checkbox(/manage security groups/i));

    await waitFor(() => {
      expect(screen.getByText(/at least one administrator must remain/i)).toBeInTheDocument();
    });
    expect(checkbox(/manage security groups/i)).not.toBeChecked();
  });

  it("reverts the checkbox when the write throws", async () => {
    mockFetch(() => Promise.reject(new Error("network down")));
    await renderDetail();

    await userEvent.click(checkbox(/view candidates/i));

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    expect(checkbox(/view candidates/i)).not.toBeChecked();
  });

  it("reverts an un-check back to checked when the write fails", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: "forbidden", message: "Not allowed" } }), { status: 403 }),
      ),
    );
    await renderDetail();

    expect(checkbox(/view recruitments/i)).toBeChecked();
    await userEvent.click(checkbox(/view recruitments/i));

    await waitFor(() => {
      expect(screen.getByText(/not allowed/i)).toBeInTheDocument();
    });
    expect(checkbox(/view recruitments/i)).toBeChecked();
  });

  // Regression for the concurrent-toggle bug found in implementation review:
  // `pendingOperation` was a single slot, so a second in-flight toggle
  // released the first one's disabled state and the first one's `finally`
  // re-enabled a checkbox whose write had not settled.
  it("disables each in-flight checkbox independently", async () => {
    const resolvers: Record<string, (value: Response) => void> = {};
    mockFetch(
      (_method, operation) =>
        new Promise<Response>((resolve) => {
          resolvers[operation] = resolve;
        }),
    );
    await renderDetail();

    await userEvent.click(checkbox(/view candidates/i));
    await userEvent.click(checkbox(/manage security groups/i));

    // Both writes are outstanding, so both controls stay locked.
    expect(checkbox(/view candidates/i)).toBeDisabled();
    expect(checkbox(/manage security groups/i)).toBeDisabled();

    resolvers["candidate.read"](
      new Response(JSON.stringify({ operations: ["recruitment.read", "candidate.read"] }), { status: 200 }),
    );

    // Settling one must not release the other.
    await waitFor(() => {
      expect(checkbox(/view candidates/i)).not.toBeDisabled();
    });
    expect(checkbox(/manage security groups/i)).toBeDisabled();
  });

  it("does not let a failing toggle undo a different toggle that succeeded", async () => {
    const resolvers: Record<string, (value: Response) => void> = {};
    mockFetch(
      (_method, operation) =>
        new Promise<Response>((resolve) => {
          resolvers[operation] = resolve;
        }),
    );
    await renderDetail();

    // Both in flight at once -- neither may be disabled by the other.
    await userEvent.click(checkbox(/view candidates/i));
    await userEvent.click(checkbox(/manage security groups/i));

    // The first succeeds...
    resolvers["candidate.read"](
      new Response(JSON.stringify({ operations: ["recruitment.read", "candidate.read"] }), { status: 200 }),
    );
    await waitFor(() => {
      expect(checkbox(/view candidates/i)).toBeChecked();
    });

    // ...then the second fails and must revert only itself.
    resolvers["group.manage"](
      new Response(JSON.stringify({ error: { code: "forbidden", message: "Not allowed" } }), { status: 403 }),
    );
    await waitFor(() => {
      expect(screen.getByText(/not allowed/i)).toBeInTheDocument();
    });

    expect(checkbox(/manage security groups/i)).not.toBeChecked();
    expect(checkbox(/view candidates/i)).toBeChecked();
  });
});
