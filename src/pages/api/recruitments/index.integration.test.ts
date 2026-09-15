/**
 * HTTP integration tests for POST /api/recruitments and PATCH
 * /api/recruitments/[id], run against a real local Supabase stack and a
 * running Astro server via src/lib/test-support/integration-client.ts.
 *
 * Prerequisites (not started by this file):
 *   1. `npx supabase start` (or `db reset`) so the seeded HR / Hiring
 *      Manager / Admin fixtures exist.
 *   2. A running Astro server at TEST_BASE_URL (default
 *      http://localhost:4321), e.g. `npm run dev` in a separate terminal.
 */
import { describe, expect, it } from "vitest";
import { signInIntegrationClient, type IntegrationClient } from "@/lib/test-support/integration-client";
import type { ApiErrorBody, SecurityGroupDto } from "@/types";

// Looks a seeded group up by name rather than assuming an ordinal id --
// seed.sql only guarantees "HR Recruiter" is a group that exists, never
// that it is group 1. Any authenticated principal can read the list
// (security_groups_select is `using (true)`), so the caller identity
// doesn't matter here.
async function groupIdByName(client: IntegrationClient, name: string): Promise<number> {
  const response = await client.fetch("/api/security-groups");
  const groups = (await response.json()) as SecurityGroupDto[];
  const match = groups.find((group) => group.name === name);
  if (!match) {
    throw new Error(`groupIdByName: no seeded security group named "${name}"`);
  }
  return match.id;
}

function validCreateBody(hrRecruiterGroupId: number, overrides: Record<string, unknown> = {}) {
  return {
    title: "Integration Test Role",
    department: "Engineering",
    location: "Remote",
    employmentType: "full-time",
    openedAt: "2026-01-01",
    groupIds: [hrRecruiterGroupId],
    ...overrides,
  };
}

describe("POST /api/recruitments", () => {
  it("HR can create a recruitment and it is immediately visible", async () => {
    const hr = await signInIntegrationClient("hr");
    const hrRecruiterGroupId = await groupIdByName(hr, "HR Recruiter");

    const createResponse = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody(hrRecruiterGroupId)),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: number; status: string };
    expect(created.status).toBe("draft");

    const listResponse = await hr.fetch("/api/recruitments");
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { id: number }[];
    expect(list.some((item) => item.id === created.id)).toBe(true);
  });

  it("Hiring Manager is denied with 403", async () => {
    const hiringManager = await signInIntegrationClient("hiringManager");
    const hrRecruiterGroupId = await groupIdByName(hiringManager, "HR Recruiter");

    const response = await hiringManager.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody(hrRecruiterGroupId)),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");
  });

  it("Admin is denied with 403", async () => {
    const admin = await signInIntegrationClient("admin");
    const hrRecruiterGroupId = await groupIdByName(admin, "HR Recruiter");

    const response = await admin.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody(hrRecruiterGroupId)),
    });

    expect(response.status).toBe(403);
  });

  it("rejects an empty groupIds array with a 422 and a field-level error", async () => {
    const hr = await signInIntegrationClient("hr");
    const hrRecruiterGroupId = await groupIdByName(hr, "HR Recruiter");

    const response = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody(hrRecruiterGroupId, { groupIds: [] })),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.fields).toHaveProperty("groupIds");
  });

  it("rejects a missing required field with a 422 and a field-level error", async () => {
    const hr = await signInIntegrationClient("hr");
    const hrRecruiterGroupId = await groupIdByName(hr, "HR Recruiter");
    const { title: _title, ...rest } = validCreateBody(hrRecruiterGroupId);

    const response = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(rest),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.fields).toHaveProperty("title");
  });
});

describe("PATCH /api/recruitments/[id]", () => {
  it("HR can change status and it persists", async () => {
    const hr = await signInIntegrationClient("hr");
    const hrRecruiterGroupId = await groupIdByName(hr, "HR Recruiter");

    const createResponse = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody(hrRecruiterGroupId)),
    });
    const created = (await createResponse.json()) as { id: number };

    const patchResponse = await hr.fetch(`/api/recruitments/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "live" }),
    });

    expect(patchResponse.status).toBe(200);
    const updated = (await patchResponse.json()) as { id: number; status: string };
    expect(updated.status).toBe("live");
  });

  it("Hiring Manager is denied with 404 (scoped-write, not authorized)", async () => {
    const hr = await signInIntegrationClient("hr");
    const hrRecruiterGroupId = await groupIdByName(hr, "HR Recruiter");
    const createResponse = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody(hrRecruiterGroupId)),
    });
    const created = (await createResponse.json()) as { id: number };

    const hiringManager = await signInIntegrationClient("hiringManager");
    const patchResponse = await hiringManager.fetch(`/api/recruitments/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "live" }),
    });

    expect(patchResponse.status).toBe(404);
  });

  it("HR can update details and the change persists across a re-fetch", async () => {
    const hr = await signInIntegrationClient("hr");
    const hrRecruiterGroupId = await groupIdByName(hr, "HR Recruiter");
    const createResponse = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody(hrRecruiterGroupId)),
    });
    const created = (await createResponse.json()) as { id: number };

    const patchResponse = await hr.fetch(`/api/recruitments/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: "Updated Role Title",
        department: "Marketing",
        location: "Warsaw",
        employmentType: "part-time",
        openedAt: "2026-02-01",
      }),
    });

    expect(patchResponse.status).toBe(200);
    const updated = (await patchResponse.json()) as { title: string; department: string | null };
    expect(updated.title).toBe("Updated Role Title");
    expect(updated.department).toBe("Marketing");

    const refetchResponse = await hr.fetch(`/api/recruitments/${created.id}`);
    if (refetchResponse.status === 200) {
      const refetched = (await refetchResponse.json()) as { title: string };
      expect(refetched.title).toBe("Updated Role Title");
    }
  });

  it("HR can clear an optional detail field and it comes back null", async () => {
    const hr = await signInIntegrationClient("hr");
    const hrRecruiterGroupId = await groupIdByName(hr, "HR Recruiter");
    const createResponse = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody(hrRecruiterGroupId)),
    });
    const created = (await createResponse.json()) as { id: number };

    const patchResponse = await hr.fetch(`/api/recruitments/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: "Role With Cleared Location",
        department: "Engineering",
        location: null,
        employmentType: "full-time",
        openedAt: "2026-01-01",
      }),
    });

    expect(patchResponse.status).toBe(200);
    const updated = (await patchResponse.json()) as { location: string | null };
    expect(updated.location).toBeNull();
  });

  it("a caller with read but not write access on the recruitment is denied with 403", async () => {
    const hr = await signInIntegrationClient("hr");
    const hrRecruiterGroupId = await groupIdByName(hr, "HR Recruiter");
    const hiringManagerGroupId = await groupIdByName(hr, "Hiring Manager");
    // Attach the Hiring Manager group too, so hiringManager has
    // recruitment.read on this recruitment but not recruitment.write --
    // otherwise it can't see the recruitment at all and gets 404 instead.
    const createResponse = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(
        validCreateBody(hrRecruiterGroupId, { groupIds: [hrRecruiterGroupId, hiringManagerGroupId] }),
      ),
    });
    const created = (await createResponse.json()) as { id: number };

    const hiringManager = await signInIntegrationClient("hiringManager");
    const patchResponse = await hiringManager.fetch(`/api/recruitments/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: "Should Not Apply",
        department: null,
        location: null,
        employmentType: null,
        openedAt: null,
      }),
    });

    expect(patchResponse.status).toBe(403);
    const body = (await patchResponse.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");
  });

  it("an unknown recruitment id returns 404", async () => {
    const hr = await signInIntegrationClient("hr");

    const patchResponse = await hr.fetch(`/api/recruitments/999999999`, {
      method: "PATCH",
      body: JSON.stringify({
        title: "Does Not Exist",
        department: null,
        location: null,
        employmentType: null,
        openedAt: null,
      }),
    });

    expect(patchResponse.status).toBe(404);
  });

  it("an over-length title returns 422 with a field-level error", async () => {
    const hr = await signInIntegrationClient("hr");
    const hrRecruiterGroupId = await groupIdByName(hr, "HR Recruiter");
    const createResponse = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody(hrRecruiterGroupId)),
    });
    const created = (await createResponse.json()) as { id: number };

    const patchResponse = await hr.fetch(`/api/recruitments/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: "x".repeat(201),
        department: null,
        location: null,
        employmentType: null,
        openedAt: null,
      }),
    });

    expect(patchResponse.status).toBe(422);
    const body = (await patchResponse.json()) as ApiErrorBody;
    expect(body.error.fields).toHaveProperty("title");
  });

  it("the status-only PATCH still returns the unchanged RecruitmentStatusDto shape", async () => {
    const hr = await signInIntegrationClient("hr");
    const hrRecruiterGroupId = await groupIdByName(hr, "HR Recruiter");
    const createResponse = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody(hrRecruiterGroupId)),
    });
    const created = (await createResponse.json()) as { id: number };

    const patchResponse = await hr.fetch(`/api/recruitments/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "live" }),
    });

    expect(patchResponse.status).toBe(200);
    const updated = (await patchResponse.json()) as Record<string, unknown>;
    expect(Object.keys(updated).sort()).toEqual(["id", "status"]);
  });
});
