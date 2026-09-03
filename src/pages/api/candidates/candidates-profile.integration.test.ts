/**
 * HTTP integration tests for the candidate-scoped profile route -- GET/PATCH
 * /api/candidates/[candidateId] -- run against a real local Supabase stack
 * and a running Astro server via src/lib/test-support/integration-client.ts.
 *
 * Prerequisites (not started by this file):
 *   1. `npx supabase start` (or `db reset`) so the seeded HR / Hiring
 *      Manager / Admin fixtures exist.
 *   2. A running Astro server at TEST_BASE_URL (default
 *      http://localhost:4321), e.g. `npm run dev` in a separate terminal.
 */
import { describe, expect, it } from "vitest";
import { signInIntegrationClient } from "@/lib/test-support/integration-client";
import type { ApiErrorBody, CandidateCardDto, CandidateProfileDto } from "@/types";

function validRecruitmentBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "Candidate Profile Integration Test",
    department: "Engineering",
    location: "Remote",
    employmentType: "full-time",
    openedAt: "2026-01-01",
    groupIds: [1],
    ...overrides,
  };
}

async function createRecruitment(overrides: Record<string, unknown> = {}): Promise<{ id: number }> {
  const hr = await signInIntegrationClient("hr");
  const response = await hr.fetch("/api/recruitments", {
    method: "POST",
    body: JSON.stringify(validRecruitmentBody(overrides)),
  });
  return (await response.json()) as { id: number };
}

async function addCandidate(recruitmentId: number, overrides: Record<string, unknown> = {}): Promise<number> {
  const hr = await signInIntegrationClient("hr");
  const response = await hr.fetch(`/api/recruitments/${recruitmentId}/candidates`, {
    method: "POST",
    body: JSON.stringify({
      fullName: "Ada Lovelace",
      email: `profile-${recruitmentId}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      ...overrides,
    }),
  });
  const card = (await response.json()) as CandidateCardDto;
  return card.id;
}

describe("GET /api/candidates/[candidateId]", () => {
  it("HR reads the profile, including the recruitment the candidate was added to", async () => {
    const recruitment = await createRecruitment();
    const candidateId = await addCandidate(recruitment.id);
    const hr = await signInIntegrationClient("hr");

    const response = await hr.fetch(`/api/candidates/${candidateId}`);

    expect(response.status).toBe(200);
    const profile = (await response.json()) as CandidateProfileDto;
    expect(profile.id).toBe(candidateId);
    expect(profile.fullName).toBe("Ada Lovelace");
    expect(profile.cv).toBeNull();
    expect(profile.recruitments.some((r) => r.recruitmentId === recruitment.id)).toBe(true);
  });

  it("a nonexistent candidate id returns 404", async () => {
    const hr = await signInIntegrationClient("hr");
    const response = await hr.fetch(`/api/candidates/999999999`);

    expect(response.status).toBe(404);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("not_found");
  });

  it("Hiring Manager can read the profile", async () => {
    const recruitment = await createRecruitment({ groupIds: [1, 2] });
    const candidateId = await addCandidate(recruitment.id);
    const hiringManager = await signInIntegrationClient("hiringManager");

    const response = await hiringManager.fetch(`/api/candidates/${candidateId}`);

    expect(response.status).toBe(200);
  });
});

describe("PATCH /api/candidates/[candidateId]", () => {
  it("HR updates name and phone; the change persists on the next GET", async () => {
    const recruitment = await createRecruitment();
    const candidateId = await addCandidate(recruitment.id);
    const hr = await signInIntegrationClient("hr");

    const response = await hr.fetch(`/api/candidates/${candidateId}`, {
      method: "PATCH",
      body: JSON.stringify({ fullName: "Ada Byron", phone: "555-0100" }),
    });

    expect(response.status).toBe(200);
    const updated = (await response.json()) as CandidateProfileDto;
    expect(updated.fullName).toBe("Ada Byron");
    expect(updated.phone).toBe("555-0100");

    const reread = await hr.fetch(`/api/candidates/${candidateId}`);
    const profile = (await reread.json()) as CandidateProfileDto;
    expect(profile.fullName).toBe("Ada Byron");
    expect(profile.phone).toBe("555-0100");
  });

  it("an attempted email change in the request body is ignored", async () => {
    const recruitment = await createRecruitment();
    const candidateId = await addCandidate(recruitment.id);
    const hr = await signInIntegrationClient("hr");

    const before = await hr.fetch(`/api/candidates/${candidateId}`);
    const beforeProfile = (await before.json()) as CandidateProfileDto;

    const response = await hr.fetch(`/api/candidates/${candidateId}`, {
      method: "PATCH",
      body: JSON.stringify({ fullName: "Ada Byron", email: "hijacked@example.com" }),
    });

    expect(response.status).toBe(200);
    const updated = (await response.json()) as CandidateProfileDto;
    expect(updated.email).toBe(beforeProfile.email);
  });

  it("a blank fullName is refused with 422", async () => {
    const recruitment = await createRecruitment();
    const candidateId = await addCandidate(recruitment.id);
    const hr = await signInIntegrationClient("hr");

    const response = await hr.fetch(`/api/candidates/${candidateId}`, {
      method: "PATCH",
      body: JSON.stringify({ fullName: "   " }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("invalid_request");
  });

  it("Hiring Manager gets a clean denial on save, and the profile is unchanged", async () => {
    // The UPDATE is plain RLS-covered SQL, not an RPC with its own
    // read-then-write permission check (a deliberate simplification per
    // plan.md Phase 2 -- a single-table write has no cross-row invariant an
    // RPC would guard). RLS on UPDATE filters the row instead of raising an
    // error, so a write-denied caller sees the same 404 "not_found" shape
    // as updateRecruitmentStatus's scoped-write pattern
    // (recruitments/index.integration.test.ts), rather than a 403 -- still
    // a clean denial, never a crash or a silently-applied write.
    const recruitment = await createRecruitment({ groupIds: [1, 2] });
    const candidateId = await addCandidate(recruitment.id);
    const hiringManager = await signInIntegrationClient("hiringManager");

    const response = await hiringManager.fetch(`/api/candidates/${candidateId}`, {
      method: "PATCH",
      body: JSON.stringify({ fullName: "Should Fail" }),
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("not_found");

    const reread = await hiringManager.fetch(`/api/candidates/${candidateId}`);
    const profile = (await reread.json()) as CandidateProfileDto;
    expect(profile.fullName).not.toBe("Should Fail");
  });

  it("a nonexistent candidate id returns 404", async () => {
    const hr = await signInIntegrationClient("hr");
    const response = await hr.fetch(`/api/candidates/999999999`, {
      method: "PATCH",
      body: JSON.stringify({ fullName: "Nobody" }),
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("not_found");
  });
});
