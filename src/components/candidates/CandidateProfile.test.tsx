import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CandidateProfile } from "@/components/candidates/CandidateProfile";
import type { CandidateProfileDto, CvUploadIntentDto } from "@/types";

const PROFILE_URL = "/api/candidates/42";

function buildProfile(overrides: Partial<CandidateProfileDto> = {}): CandidateProfileDto {
  return {
    id: 42,
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+48 600 100 100",
    createdAt: "2026-01-02T10:00:00Z",
    recruitments: [
      {
        recruitmentId: 1,
        candidateRecruitmentId: 5,
        title: "Backend Engineer",
        stageName: "New",
        addedAt: "2026-01-02",
      },
    ],
    cv: null,
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

interface FetchConfig {
  profileResponse?: { status: number; body: unknown };
  intentResponse?: { status: number; body: unknown };
  putStatus?: number;
  confirmResponse?: { status: number; body: unknown };
}

function mockFetch(config: FetchConfig) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";

    if (url === PROFILE_URL && method === "GET") {
      const { status, body } = config.profileResponse ?? { status: 200, body: buildProfile() };
      return Promise.resolve(jsonResponse(status, body));
    }

    if (url === `${PROFILE_URL}/cv/upload-intent` && method === "POST") {
      const { status, body } = config.intentResponse ?? {
        status: 200,
        body: {
          cvId: 7,
          uploadUrl: "https://storage.example/signed",
          token: "signed-token",
          path: "42/7-abc.pdf",
        } satisfies CvUploadIntentDto,
      };
      return Promise.resolve(jsonResponse(status, body));
    }

    if (url === "https://storage.example/signed" && method === "PUT") {
      return Promise.resolve(new Response(null, { status: config.putStatus ?? 200 }));
    }

    if (url === `${PROFILE_URL}/cv/confirm` && method === "POST") {
      const { status, body } = config.confirmResponse ?? {
        status: 200,
        body: {
          id: 7,
          originalFilename: "cv.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          uploadedAt: "2026-01-05T10:00:00Z",
          expiresAt: "2027-01-05T10:00:00Z",
          state: "available",
        },
      };
      return Promise.resolve(jsonResponse(status, body));
    }

    throw new Error(`Unexpected fetch call: ${url} ${method}`);
  });
}

describe("CandidateProfile", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders an upload control when the candidate has no CV", async () => {
    vi.stubGlobal("fetch", mockFetch({}));

    render(<CandidateProfile candidateId="42" />);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByLabelText(/upload cv/i)).toBeInTheDocument();
    expect(screen.queryByText(/download/i)).not.toBeInTheDocument();
  });

  it("renders filename, size, upload date and a download link for an available CV", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        profileResponse: {
          status: 200,
          body: buildProfile({
            cv: {
              id: 7,
              originalFilename: "cv.pdf",
              mimeType: "application/pdf",
              sizeBytes: 204800,
              uploadedAt: "2026-01-05T10:00:00Z",
              expiresAt: "2027-01-05T10:00:00Z",
              state: "available",
            },
          }),
        },
      }),
    );

    render(<CandidateProfile candidateId="42" />);

    expect(await screen.findByText("cv.pdf")).toBeInTheDocument();
    expect(screen.getByText(/200 KB/i)).toBeInTheDocument();
    const downloadLink = screen.getByRole("link", { name: /download/i });
    expect(downloadLink).toHaveAttribute("href", `${PROFILE_URL}/cv`);
  });

  it("renders a tombstone with the original upload date for an expired CV", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        profileResponse: {
          status: 200,
          body: buildProfile({
            cv: {
              id: 3,
              originalFilename: "old-cv.pdf",
              mimeType: "application/pdf",
              sizeBytes: 1024,
              uploadedAt: "2025-01-01T10:00:00Z",
              expiresAt: "2026-01-01T10:00:00Z",
              state: "expired",
            },
          }),
        },
      }),
    );

    render(<CandidateProfile candidateId="42" />);

    expect(await screen.findByText(/removed after 12 months/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/upload cv/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
  });

  it("uploads a file via intent -> PUT -> confirm, in order, then refetches the profile", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateProfile candidateId="42" />);
    await screen.findByText("Ada Lovelace");

    const file = new File(["%PDF-1.4"], "cv.pdf", { type: "application/pdf" });
    const input = screen.getByLabelText(/upload cv/i);
    await user.upload(input, file);

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(callUrl);
      expect(calls).toContain(`${PROFILE_URL}/cv/upload-intent`);
      expect(calls).toContain("https://storage.example/signed");
      expect(calls).toContain(`${PROFILE_URL}/cv/confirm`);
    });

    const calls = fetchMock.mock.calls.map(callUrl);
    const intentIdx = calls.indexOf(`${PROFILE_URL}/cv/upload-intent`);
    const putIdx = calls.indexOf("https://storage.example/signed");
    const confirmIdx = calls.indexOf(`${PROFILE_URL}/cv/confirm`);
    expect(intentIdx).toBeLessThan(putIdx);
    expect(putIdx).toBeLessThan(confirmIdx);

    // Confirm succeeding triggers a profile refetch (a second GET on PROFILE_URL).
    await waitFor(() => {
      const getCalls = fetchMock.mock.calls.filter(
        (call) => callUrl(call) === PROFILE_URL && (call[1]?.method ?? "GET") === "GET",
      );
      expect(getCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("rejects an oversized file client-side without making any network call", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateProfile candidateId="42" />);
    await screen.findByText("Ada Lovelace");

    const oversized = new File([new Uint8Array(6 * 1024 * 1024)], "big.pdf", { type: "application/pdf" });
    const input = screen.getByLabelText(/upload cv/i);
    await user.upload(input, oversized);

    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    const intentCalls = fetchMock.mock.calls.filter((call) => callUrl(call) === `${PROFILE_URL}/cv/upload-intent`);
    expect(intentCalls).toHaveLength(0);
  });

  it("rejects a wrong-type file client-side without making any network call", async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateProfile candidateId="42" />);
    await screen.findByText("Ada Lovelace");

    const wrongType = new File(["hello"], "notes.txt", { type: "text/plain" });
    const input = screen.getByLabelText(/upload cv/i);
    // userEvent.upload honors the input's `accept` filter and silently no-ops
    // for a non-matching file, the same way a real browser file dialog does;
    // firing the change event directly exercises our own validation instead.
    fireEvent.change(input, { target: { files: [wrongType] } });

    expect(await screen.findByText(/only pdf or word/i)).toBeInTheDocument();
    const intentCalls = fetchMock.mock.calls.filter((call) => callUrl(call) === `${PROFILE_URL}/cv/upload-intent`);
    expect(intentCalls).toHaveLength(0);
  });

  it("renders a clean 403 message when a hiring manager attempts to upload", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({
      intentResponse: {
        status: 403,
        body: { error: { code: "forbidden", message: "You do not have permission to upload a CV." } },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateProfile candidateId="42" />);
    await screen.findByText("Ada Lovelace");

    const file = new File(["%PDF-1.4"], "cv.pdf", { type: "application/pdf" });
    const input = screen.getByLabelText(/upload cv/i);
    await user.upload(input, file);

    expect(await screen.findByText(/you do not have permission to upload a cv/i)).toBeInTheDocument();
  });
});
