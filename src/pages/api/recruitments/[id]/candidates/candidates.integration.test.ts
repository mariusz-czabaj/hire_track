/**
 * HTTP integration tests for the candidate write paths -- POST
 * /api/recruitments/[id]/candidates, PATCH .../candidates/[candidateId],
 * and PUT .../candidates/[candidateId]/notes -- run against a real local
 * Supabase stack and a running Astro server via
 * src/lib/test-support/integration-client.ts.
 *
 * Prerequisites (not started by this file):
 *   1. `npx supabase start` (or `db reset`) so the seeded HR / Hiring
 *      Manager / Admin fixtures exist.
 *   2. A running Astro server at TEST_BASE_URL (default
 *      http://localhost:4321), e.g. `npm run dev` in a separate terminal.
 */
import { describe, expect, it } from "vitest";
import { signInIntegrationClient } from "@/lib/test-support/integration-client";
import type { ApiErrorBody, CandidateCardDto, CandidateDetailDto } from "@/types";

function validRecruitmentBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "Candidates Integration Test",
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

async function addCandidate(
  recruitmentId: number,
  overrides: Record<string, unknown> = {},
): Promise<{ candidateRecruitmentId: number; card: CandidateCardDto }> {
  const hr = await signInIntegrationClient("hr");
  const response = await hr.fetch(`/api/recruitments/${recruitmentId}/candidates`, {
    method: "POST",
    body: JSON.stringify({
      fullName: "Ada Lovelace",
      email: `ada-${recruitmentId}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      ...overrides,
    }),
  });
  const card = (await response.json()) as CandidateCardDto & { candidateRecruitmentId: number };

  return { candidateRecruitmentId: card.candidateRecruitmentId, card };
}

describe("POST /api/recruitments/[id]/candidates", () => {
  it("HR adds a candidate and it is immediately visible on the board", async () => {
    const recruitment = await createRecruitment();
    const hr = await signInIntegrationClient("hr");

    const response = await hr.fetch(`/api/recruitments/${recruitment.id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ fullName: "Grace Hopper", email: `grace-${Date.now()}@example.com` }),
    });

    expect(response.status).toBe(201);
    const card = (await response.json()) as CandidateCardDto;
    expect(card.fullName).toBe("Grace Hopper");

    const board = await hr.fetch(`/api/recruitments/${recruitment.id}/board`);
    const boardBody = (await board.json()) as { stages: { candidates: { fullName: string }[] }[] };
    expect(boardBody.stages[0].candidates.some((c) => c.fullName === "Grace Hopper")).toBe(true);
  });

  it("a duplicate link for the same candidate and recruitment is refused with 422", async () => {
    const recruitment = await createRecruitment();
    const hr = await signInIntegrationClient("hr");
    const email = `dup-${Date.now()}@example.com`;

    await hr.fetch(`/api/recruitments/${recruitment.id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ fullName: "Dup Candidate", email }),
    });

    const response = await hr.fetch(`/api/recruitments/${recruitment.id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ fullName: "Dup Candidate", email }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("invalid_request");
  });

  it("an email match under a different name is refused with candidate_name_mismatch", async () => {
    const recruitment = await createRecruitment();
    const otherRecruitment = await createRecruitment();
    const hr = await signInIntegrationClient("hr");
    const email = `mismatch-${Date.now()}@example.com`;

    await hr.fetch(`/api/recruitments/${recruitment.id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ fullName: "Original Name", email }),
    });

    const response = await hr.fetch(`/api/recruitments/${otherRecruitment.id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ fullName: "Different Name", email }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("candidate_name_mismatch");
  });

  it("Hiring Manager (can see the board) is denied with a clean 403", async () => {
    const recruitment = await createRecruitment({ groupIds: [1, 2] });
    const hiringManager = await signInIntegrationClient("hiringManager");

    const response = await hiringManager.fetch(`/api/recruitments/${recruitment.id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ fullName: "Should Fail", email: `hm-${Date.now()}@example.com` }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");
  });

  it("Administrator on a recruitment they are not linked to is denied with 404", async () => {
    const recruitment = await createRecruitment();
    const admin = await signInIntegrationClient("admin");

    const response = await admin.fetch(`/api/recruitments/${recruitment.id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ fullName: "Should Fail", email: `admin-${Date.now()}@example.com` }),
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("not_found");
  });
});

describe("PATCH /api/recruitments/[id]/candidates/[candidateId]", () => {
  it("a move with no note for the current stage is blocked with 422 note_required", async () => {
    const recruitment = await createRecruitment();
    const { candidateRecruitmentId } = await addCandidate(recruitment.id);
    const hr = await signInIntegrationClient("hr");

    const board = await hr.fetch(`/api/recruitments/${recruitment.id}/board`);
    const boardBody = (await board.json()) as { stages: { id: number }[] };
    const targetStageId = boardBody.stages[1].id;

    const response = await hr.fetch(`/api/recruitments/${recruitment.id}/candidates/${candidateRecruitmentId}`, {
      method: "PATCH",
      body: JSON.stringify({ toStageId: targetStageId }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("note_required");
  });

  it("supplying the note in the same PATCH both saves it and performs the move", async () => {
    const recruitment = await createRecruitment();
    const { candidateRecruitmentId } = await addCandidate(recruitment.id);
    const hr = await signInIntegrationClient("hr");

    const board = await hr.fetch(`/api/recruitments/${recruitment.id}/board`);
    const boardBody = (await board.json()) as { stages: { id: number }[] };
    const targetStageId = boardBody.stages[1].id;

    const response = await hr.fetch(`/api/recruitments/${recruitment.id}/candidates/${candidateRecruitmentId}`, {
      method: "PATCH",
      body: JSON.stringify({ toStageId: targetStageId, note: "Great technical screen." }),
    });

    expect(response.status).toBe(200);
    const result = (await response.json()) as { id: number; currentStageId: number };
    expect(result.currentStageId).toBe(targetStageId);

    const detail = await hr.fetch(`/api/recruitments/${recruitment.id}/candidates/${candidateRecruitmentId}`);
    const detailBody = (await detail.json()) as CandidateDetailDto;
    const firstStageNote = detailBody.notes.find((n) => n.stageId === boardBody.stages[0].id);
    expect(firstStageNote?.body).toBe("Great technical screen.");
  });

  it("a backward move works once the current stage has a note", async () => {
    const recruitment = await createRecruitment();
    const { candidateRecruitmentId } = await addCandidate(recruitment.id);
    const hr = await signInIntegrationClient("hr");

    const board = await hr.fetch(`/api/recruitments/${recruitment.id}/board`);
    const boardBody = (await board.json()) as { stages: { id: number }[] };
    const [firstStageId, secondStageId] = boardBody.stages.map((s) => s.id);

    await hr.fetch(`/api/recruitments/${recruitment.id}/candidates/${candidateRecruitmentId}`, {
      method: "PATCH",
      body: JSON.stringify({ toStageId: secondStageId, note: "Moving forward." }),
    });

    const backward = await hr.fetch(`/api/recruitments/${recruitment.id}/candidates/${candidateRecruitmentId}`, {
      method: "PATCH",
      body: JSON.stringify({ toStageId: firstStageId, note: "Reopening." }),
    });

    expect(backward.status).toBe(200);
    const result = (await backward.json()) as { currentStageId: number };
    expect(result.currentStageId).toBe(firstStageId);
  });

  it("Hiring Manager (can see the board) is denied with a clean 403", async () => {
    const recruitment = await createRecruitment({ groupIds: [1, 2] });
    const { candidateRecruitmentId } = await addCandidate(recruitment.id);
    const hiringManager = await signInIntegrationClient("hiringManager");

    const board = await signInIntegrationClient("hr").then((hr) =>
      hr.fetch(`/api/recruitments/${recruitment.id}/board`),
    );
    const boardBody = (await board.json()) as { stages: { id: number }[] };

    const response = await hiringManager.fetch(
      `/api/recruitments/${recruitment.id}/candidates/${candidateRecruitmentId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ toStageId: boardBody.stages[1].id, note: "Attempted by HM." }),
      },
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");
  });

  it("Administrator on a recruitment they are not linked to is denied with 404", async () => {
    const recruitment = await createRecruitment();
    const { candidateRecruitmentId } = await addCandidate(recruitment.id);
    const admin = await signInIntegrationClient("admin");

    const response = await admin.fetch(`/api/recruitments/${recruitment.id}/candidates/${candidateRecruitmentId}`, {
      method: "PATCH",
      body: JSON.stringify({ toStageId: candidateRecruitmentId, note: "Attempted by admin." }),
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("not_found");
  });
});

describe("PUT /api/recruitments/[id]/candidates/[candidateId]/notes", () => {
  it("HR upserts a note and it is reflected on the detail page", async () => {
    const recruitment = await createRecruitment();
    const { candidateRecruitmentId } = await addCandidate(recruitment.id);
    const hr = await signInIntegrationClient("hr");

    const board = await hr.fetch(`/api/recruitments/${recruitment.id}/board`);
    const boardBody = (await board.json()) as { stages: { id: number }[] };
    const stageId = boardBody.stages[0].id;

    const response = await hr.fetch(`/api/recruitments/${recruitment.id}/candidates/${candidateRecruitmentId}/notes`, {
      method: "PUT",
      body: JSON.stringify({ stageId, body: "Solid first impression." }),
    });

    expect(response.status).toBe(200);

    const detail = await hr.fetch(`/api/recruitments/${recruitment.id}/candidates/${candidateRecruitmentId}`);
    const detailBody = (await detail.json()) as CandidateDetailDto;
    const note = detailBody.notes.find((n) => n.stageId === stageId);
    expect(note?.body).toBe("Solid first impression.");
    expect(note?.authorEmail).toBe("hr.test@example.com");
  });

  it("a blank body is refused with 422", async () => {
    const recruitment = await createRecruitment();
    const { candidateRecruitmentId } = await addCandidate(recruitment.id);
    const hr = await signInIntegrationClient("hr");

    const board = await hr.fetch(`/api/recruitments/${recruitment.id}/board`);
    const boardBody = (await board.json()) as { stages: { id: number }[] };

    const response = await hr.fetch(`/api/recruitments/${recruitment.id}/candidates/${candidateRecruitmentId}/notes`, {
      method: "PUT",
      body: JSON.stringify({ stageId: boardBody.stages[0].id, body: "   " }),
    });

    expect(response.status).toBe(422);
  });

  it("Hiring Manager (can see the board) is denied with a clean 403", async () => {
    const recruitment = await createRecruitment({ groupIds: [1, 2] });
    const { candidateRecruitmentId } = await addCandidate(recruitment.id);
    const hiringManager = await signInIntegrationClient("hiringManager");

    const board = await signInIntegrationClient("hr").then((hr) =>
      hr.fetch(`/api/recruitments/${recruitment.id}/board`),
    );
    const boardBody = (await board.json()) as { stages: { id: number }[] };

    const response = await hiringManager.fetch(
      `/api/recruitments/${recruitment.id}/candidates/${candidateRecruitmentId}/notes`,
      {
        method: "PUT",
        body: JSON.stringify({ stageId: boardBody.stages[0].id, body: "Attempted by HM." }),
      },
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");
  });
});
