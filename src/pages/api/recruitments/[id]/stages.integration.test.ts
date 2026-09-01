/**
 * HTTP integration tests for GET/PUT/DELETE /api/recruitments/[id]/stages,
 * run against a real local Supabase stack and a running Astro server via
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
import type { ApiErrorBody } from "@/types";

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "Stages Integration Test",
    department: "Engineering",
    location: "Remote",
    employmentType: "full-time",
    openedAt: "2026-01-01",
    groupIds: [1],
    ...overrides,
  };
}

async function createCandidateFreeRecruitment(overrides: Record<string, unknown> = {}): Promise<{ id: number }> {
  const hr = await signInIntegrationClient("hr");
  const response = await hr.fetch("/api/recruitments", {
    method: "POST",
    body: JSON.stringify(validCreateBody(overrides)),
  });
  return (await response.json()) as { id: number };
}

describe("GET/PUT/DELETE /api/recruitments/[id]/stages", () => {
  it("HR replaces a candidate-free recruitment's stages and the board reflects it", async () => {
    const created = await createCandidateFreeRecruitment();
    const hr = await signInIntegrationClient("hr");

    const putResponse = await hr.fetch(`/api/recruitments/${created.id}/stages`, {
      method: "PUT",
      body: JSON.stringify({ stages: [{ name: "Applied" }, { name: "Tech Interview" }] }),
    });

    expect(putResponse.status).toBe(200);
    const putBody = (await putResponse.json()) as { stagesSource: string; stages: { name: string }[] };
    expect(putBody.stagesSource).toBe("custom");
    expect(putBody.stages.map((s) => s.name)).toEqual(["Applied", "Tech Interview"]);

    const boardResponse = await hr.fetch(`/api/recruitments/${created.id}/board`);
    const board = (await boardResponse.json()) as { stagesSource: string; stages: { name: string }[] };
    expect(board.stagesSource).toBe("custom");
    expect(board.stages.map((s) => s.name)).toEqual(["Applied", "Tech Interview"]);
  });

  it("HR targeting the seeded recruitment (which has candidates) is refused with 422", async () => {
    const hr = await signInIntegrationClient("hr");

    // Recruitment id 1 is the seeded "Backend Engineer" recruitment, which
    // always has candidates from supabase/seed.sql.
    const putResponse = await hr.fetch("/api/recruitments/1/stages", {
      method: "PUT",
      body: JSON.stringify({ stages: [{ name: "Should Fail" }] }),
    });

    expect(putResponse.status).toBe(422);
    const body = (await putResponse.json()) as ApiErrorBody;
    expect(body.error.code).toBe("stages_locked");
  });

  it("Hiring Manager (can see the board) is denied with a clean 403", async () => {
    // group 2 = Hiring Manager -- assigned alongside HR/Rekruter so this
    // recruitment is actually visible (recruitment.read) to the Hiring
    // Manager, exercising the visible-but-no-write 403 path rather than
    // the caller-cannot-see 404 path.
    const created = await createCandidateFreeRecruitment({ groupIds: [1, 2] });
    const hiringManager = await signInIntegrationClient("hiringManager");

    const putResponse = await hiringManager.fetch(`/api/recruitments/${created.id}/stages`, {
      method: "PUT",
      body: JSON.stringify({ stages: [{ name: "Should Fail" }] }),
    });

    expect(putResponse.status).toBe(403);
    const body = (await putResponse.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");
  });

  it("Administrator on a recruitment they are not linked to is denied with 404", async () => {
    const created = await createCandidateFreeRecruitment();
    const admin = await signInIntegrationClient("admin");

    const putResponse = await admin.fetch(`/api/recruitments/${created.id}/stages`, {
      method: "PUT",
      body: JSON.stringify({ stages: [{ name: "Should Fail" }] }),
    });

    expect(putResponse.status).toBe(404);
    const body = (await putResponse.json()) as ApiErrorBody;
    expect(body.error.code).toBe("not_found");
  });

  it("reset restores the global defaults and flips stagesSource", async () => {
    const created = await createCandidateFreeRecruitment();
    const hr = await signInIntegrationClient("hr");

    await hr.fetch(`/api/recruitments/${created.id}/stages`, {
      method: "PUT",
      body: JSON.stringify({ stages: [{ name: "Applied" }] }),
    });

    const deleteResponse = await hr.fetch(`/api/recruitments/${created.id}/stages`, {
      method: "DELETE",
    });

    expect(deleteResponse.status).toBe(200);
    const body = (await deleteResponse.json()) as { stagesSource: string; stages: { name: string }[] };
    expect(body.stagesSource).toBe("default");
    expect(body.stages.map((s) => s.name)).toEqual(["New", "Screening", "Interview", "Offer", "Hired", "Rejected"]);
  });
});
