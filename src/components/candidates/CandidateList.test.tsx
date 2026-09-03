import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CandidateList } from "@/components/candidates/CandidateList";
import type { CandidateListDto, CandidateListItemDto } from "@/types";

function buildItem(overrides: Partial<CandidateListItemDto> = {}): CandidateListItemDto {
  return {
    id: 1,
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    recruitmentCount: 2,
    ...overrides,
  };
}

function buildList(overrides: Partial<CandidateListDto> = {}): CandidateListDto {
  return {
    items: [buildItem()],
    truncated: false,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function callUrl(call: [RequestInfo | URL, RequestInit?]): string {
  const [input] = call;
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function mockFetch(byUrl: (url: string) => { status: number; body: unknown }) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { status, body } = byUrl(url);
    return Promise.resolve(jsonResponse(status, body));
  });
}

describe("CandidateList", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders returned candidates", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({ status: 200, body: buildList() })),
    );

    render(<CandidateList />);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("2 recruitments")).toBeInTheDocument();
  });

  it("typing filters via the debounced URL, issuing roughly one request", async () => {
    const fetchMock = mockFetch((url) => ({
      status: 200,
      body: url.includes("q=Lov") ? buildList() : buildList({ items: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateList />);
    await screen.findByText(/no candidates match this search/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();

    const input = screen.getByLabelText(/search candidates by name/i);
    fireEvent.change(input, { target: { value: "Lov" } });
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();

    await screen.findByText("Ada Lovelace");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls.map(callUrl);
    expect(calls[calls.length - 1]).toContain("q=Lov");
  });

  it("renders the empty state for a search with no matches", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({ status: 200, body: buildList({ items: [] }) })),
    );

    render(<CandidateList initialQuery="zzz" />);

    expect(await screen.findByText(/no candidates match this search/i)).toBeInTheDocument();
  });

  it("renders the refine hint only when the truncation flag is set", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({ status: 200, body: buildList({ truncated: true }) })),
    );

    render(<CandidateList />);

    expect(await screen.findByText(/refine your search/i)).toBeInTheDocument();
  });

  it("does not render the refine hint when results are not truncated", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({ status: 200, body: buildList({ truncated: false }) })),
    );

    render(<CandidateList />);

    await screen.findByText("Ada Lovelace");
    expect(screen.queryByText(/refine your search/i)).not.toBeInTheDocument();
  });
});
