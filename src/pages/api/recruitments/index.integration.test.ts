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
import { signInIntegrationClient } from "@/lib/test-support/integration-client";
import type { ApiErrorBody } from "@/types";

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "Integration Test Role",
    department: "Engineering",
    location: "Remote",
    employmentType: "full-time",
    openedAt: "2026-01-01",
    groupIds: [1],
    ...overrides,
  };
}

describe("POST /api/recruitments", () => {
  it("HR can create a recruitment and it is immediately visible", async () => {
    const hr = await signInIntegrationClient("hr");

    const createResponse = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody()),
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

    const response = await hiringManager.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody()),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");
  });

  it("Admin is denied with 403", async () => {
    const admin = await signInIntegrationClient("admin");

    const response = await admin.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody()),
    });

    expect(response.status).toBe(403);
  });

  it("rejects an empty groupIds array with a 422 and a field-level error", async () => {
    const hr = await signInIntegrationClient("hr");

    const response = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody({ groupIds: [] })),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.fields).toHaveProperty("groupIds");
  });

  it("rejects a missing required field with a 422 and a field-level error", async () => {
    const hr = await signInIntegrationClient("hr");
    const { title: _title, ...rest } = validCreateBody();

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

    const createResponse = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody()),
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
    const createResponse = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify(validCreateBody()),
    });
    const created = (await createResponse.json()) as { id: number };

    const hiringManager = await signInIntegrationClient("hiringManager");
    const patchResponse = await hiringManager.fetch(`/api/recruitments/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "live" }),
    });

    expect(patchResponse.status).toBe(404);
  });
});
