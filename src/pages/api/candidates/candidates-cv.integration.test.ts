/**
 * HTTP integration tests for the CV lifecycle -- upload-intent, confirm,
 * download, and purge -- run against a real local Supabase stack and a
 * running Astro server via src/lib/test-support/integration-client.ts.
 *
 * Prerequisites (not started by this file):
 *   1. `npx supabase start` (or `db reset`) so the seeded HR / Hiring
 *      Manager / Admin fixtures exist.
 *   2. A running Astro server at TEST_BASE_URL (default
 *      http://localhost:4321), e.g. `npm run dev` in a separate terminal.
 *
 * The signed-upload PUT is done with a raw fetch rather than the
 * supabase-js storage client -- these tests exercise the same HTTP
 * contract a browser would, not the SDK.
 */
import { describe, expect, it } from "vitest";
import {
  getAccessTokenForRole,
  signInIntegrationClient,
  supabaseRestUrl,
  SUPABASE_ANON_KEY,
} from "@/lib/test-support/integration-client";
import type { ApiErrorBody, CandidateCardDto, CandidateCvDto, CvPurgeSummaryDto, CvUploadIntentDto } from "@/types";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 fake candidate cv content for integration testing");

function validRecruitmentBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "CV Lifecycle Integration Test",
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
      email: `cv-${recruitmentId}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      ...overrides,
    }),
  });
  const card = (await response.json()) as CandidateCardDto;
  return card.id;
}

/** Runs the mint -> PUT -> confirm sequence as HR and returns the confirmed DTO. */
async function uploadCv(candidateId: number): Promise<CandidateCvDto> {
  const hr = await signInIntegrationClient("hr");

  const intentResponse = await hr.fetch(`/api/candidates/${candidateId}/cv/upload-intent`, {
    method: "POST",
    body: JSON.stringify({ filename: "cv.pdf", mimeType: "application/pdf", sizeBytes: PDF_BYTES.byteLength }),
  });
  expect(intentResponse.status).toBe(200);
  const intent = (await intentResponse.json()) as CvUploadIntentDto;

  const putResponse = await fetch(intent.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: PDF_BYTES,
  });
  expect(putResponse.ok).toBe(true);

  const confirmResponse = await hr.fetch(`/api/candidates/${candidateId}/cv/confirm`, {
    method: "POST",
    body: JSON.stringify({ cvId: intent.cvId }),
  });
  expect(confirmResponse.status).toBe(200);
  return (await confirmResponse.json()) as CandidateCvDto;
}

/** Inserts a candidate_cvs row directly via PostgREST with a backdated uploaded_at, bypassing the mint/PUT/confirm path -- exercises the set_expires_at trigger the way plan.md's manual step does by hand. */
async function insertBackdatedActiveCv(candidateId: number): Promise<number> {
  const accessToken = await getAccessTokenForRole("hr");
  const response = await fetch(supabaseRestUrl("/candidate_cvs"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      candidate_id: candidateId,
      storage_path: `${candidateId}/backdated-${Date.now()}.pdf`,
      original_filename: "expired.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      status: "active",
      uploaded_at: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  });
  const rows = (await response.json()) as { id: number }[];
  return rows[0].id;
}

describe("POST /api/candidates/[candidateId]/cv/upload-intent, /confirm, GET /cv", () => {
  it("HR uploads a CV through a minted URL and downloads the same bytes back", async () => {
    const recruitment = await createRecruitment();
    const candidateId = await addCandidate(recruitment.id);

    const cv = await uploadCv(candidateId);
    expect(cv.originalFilename).toBe("cv.pdf");
    expect(cv.state).toBe("available");

    const hr = await signInIntegrationClient("hr");
    const download = await hr.fetch(`/api/candidates/${candidateId}/cv`);
    expect(download.status).toBe(200);
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(bytes).toEqual(PDF_BYTES);
  });

  it("replacing a CV leaves exactly one active CV on the profile", async () => {
    const recruitment = await createRecruitment();
    const candidateId = await addCandidate(recruitment.id);

    await uploadCv(candidateId);
    const second = await uploadCv(candidateId);

    const hr = await signInIntegrationClient("hr");
    const profileResponse = await hr.fetch(`/api/candidates/${candidateId}`);
    const profile = (await profileResponse.json()) as { cv: CandidateCvDto | null };
    expect(profile.cv?.id).toBe(second.id);
  });

  it("Hiring Manager gets a clean 403 minting an upload intent", async () => {
    const recruitment = await createRecruitment({ groupIds: [1, 2] });
    const candidateId = await addCandidate(recruitment.id);
    const hiringManager = await signInIntegrationClient("hiringManager");

    const response = await hiringManager.fetch(`/api/candidates/${candidateId}/cv/upload-intent`, {
      method: "POST",
      body: JSON.stringify({ filename: "cv.pdf", mimeType: "application/pdf", sizeBytes: 1024 }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");
  });

  it("an oversized upload intent is refused with 422 before minting", async () => {
    const recruitment = await createRecruitment();
    const candidateId = await addCandidate(recruitment.id);
    const hr = await signInIntegrationClient("hr");

    const response = await hr.fetch(`/api/candidates/${candidateId}/cv/upload-intent`, {
      method: "POST",
      body: JSON.stringify({ filename: "big.pdf", mimeType: "application/pdf", sizeBytes: 6 * 1024 * 1024 }),
    });

    expect(response.status).toBe(422);
  });

  it("a wrong MIME type is refused with 422", async () => {
    const recruitment = await createRecruitment();
    const candidateId = await addCandidate(recruitment.id);
    const hr = await signInIntegrationClient("hr");

    const response = await hr.fetch(`/api/candidates/${candidateId}/cv/upload-intent`, {
      method: "POST",
      body: JSON.stringify({ filename: "notes.txt", mimeType: "text/plain", sizeBytes: 1024 }),
    });

    expect(response.status).toBe(422);
  });

  it("confirming a cvId under a different candidate's URL is refused with 404", async () => {
    const recruitment = await createRecruitment();
    const ownerCandidateId = await addCandidate(recruitment.id);
    const otherCandidateId = await addCandidate(recruitment.id, {
      fullName: "Grace Hopper",
      email: `cv-other-${recruitment.id}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    });

    const hr = await signInIntegrationClient("hr");
    const intentResponse = await hr.fetch(`/api/candidates/${ownerCandidateId}/cv/upload-intent`, {
      method: "POST",
      body: JSON.stringify({ filename: "cv.pdf", mimeType: "application/pdf", sizeBytes: PDF_BYTES.byteLength }),
    });
    const intent = (await intentResponse.json()) as CvUploadIntentDto;
    await fetch(intent.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: PDF_BYTES,
    });

    // Confirm the owner's pending cvId, but under a different candidate's URL.
    const confirmResponse = await hr.fetch(`/api/candidates/${otherCandidateId}/cv/confirm`, {
      method: "POST",
      body: JSON.stringify({ cvId: intent.cvId }),
    });

    expect(confirmResponse.status).toBe(404);
    const body = (await confirmResponse.json()) as ApiErrorBody;
    expect(body.error.code).toBe("not_found");

    // The CV must still confirm cleanly under its true owner's URL.
    const retryResponse = await hr.fetch(`/api/candidates/${ownerCandidateId}/cv/confirm`, {
      method: "POST",
      body: JSON.stringify({ cvId: intent.cvId }),
    });
    expect(retryResponse.status).toBe(200);
  });

  it("a backdated CV returns 410 cv_expired on download", async () => {
    const recruitment = await createRecruitment();
    const candidateId = await addCandidate(recruitment.id);
    await insertBackdatedActiveCv(candidateId);

    const hr = await signInIntegrationClient("hr");
    const response = await hr.fetch(`/api/candidates/${candidateId}/cv`);

    expect(response.status).toBe(410);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("cv_expired");
  });
});

describe("POST /api/candidates/cv-purge", () => {
  it("HR purges a backdated CV, setting object_deleted_at, and a second run is harmless", async () => {
    const recruitment = await createRecruitment();
    const candidateId = await addCandidate(recruitment.id);
    await insertBackdatedActiveCv(candidateId);

    const hr = await signInIntegrationClient("hr");
    const first = await hr.fetch("/api/candidates/cv-purge", { method: "POST" });
    expect(first.status).toBe(200);
    const firstSummary = (await first.json()) as CvPurgeSummaryDto;
    expect(firstSummary.results.some((result) => result.removed)).toBe(true);

    const second = await hr.fetch("/api/candidates/cv-purge", { method: "POST" });
    expect(second.status).toBe(200);
    const secondSummary = (await second.json()) as CvPurgeSummaryDto;
    expect(secondSummary.results.every((result) => result.cvId !== firstSummary.results[0]?.cvId)).toBe(true);
  });

  it("Administrator can purge", async () => {
    const admin = await signInIntegrationClient("admin");
    const response = await admin.fetch("/api/candidates/cv-purge", { method: "POST" });
    expect(response.status).toBe(200);
  });

  it("Hiring Manager gets a clean 403 on purge", async () => {
    const hiringManager = await signInIntegrationClient("hiringManager");
    const response = await hiringManager.fetch("/api/candidates/cv-purge", { method: "POST" });
    expect(response.status).toBe(403);
  });
});
