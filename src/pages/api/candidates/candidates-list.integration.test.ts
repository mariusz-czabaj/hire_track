/**
 * HTTP integration tests for the global candidates list -- GET
 * /api/candidates -- run against a real local Supabase stack and a running
 * Astro server via src/lib/test-support/integration-client.ts.
 *
 * The harness has no reset between tests (test-plan.md §6.4's cookbook
 * rule), so every assertion here checks the presence and relative order of
 * known candidates, never a total count.
 *
 * Prerequisites (not started by this file):
 *   1. `npx supabase db reset --local` so the Phase 1 cross-tenant fixture
 *      (Julia Wojcik) exists.
 *   2. A running Astro server at TEST_BASE_URL (default
 *      http://localhost:4321), e.g. `npm run dev` in a separate terminal.
 */
import { describe, expect, it } from "vitest";
import { signInIntegrationClient } from "@/lib/test-support/integration-client";
import type { ApiErrorBody, CandidateListDto } from "@/types";

// The Phase 1 cross-tenant fixture (supabase/seed.sql): a distinctive
// surname fragment and a distinctive first-name fragment, both unique to
// this candidate, so a match can't be confused with any other seed row.
const CROSS_TENANT_CANDIDATE_NAME = "Julia Wojcik";
const SURNAME_FRAGMENT = "ojci";
const FIRST_NAME_FRAGMENT = "Juli";

describe("GET /api/candidates", () => {
  it("a search matching a surname fragment returns the cross-tenant candidate", async () => {
    const hr = await signInIntegrationClient("hr");
    const response = await hr.fetch(`/api/candidates?q=${SURNAME_FRAGMENT}`);

    expect(response.status).toBe(200);
    const list = (await response.json()) as CandidateListDto;
    expect(list.items.some((item) => item.fullName === CROSS_TENANT_CANDIDATE_NAME)).toBe(true);
  });

  it("a search matching a first-name fragment returns the same candidate", async () => {
    const hr = await signInIntegrationClient("hr");
    const response = await hr.fetch(`/api/candidates?q=${FIRST_NAME_FRAGMENT}`);

    expect(response.status).toBe(200);
    const list = (await response.json()) as CandidateListDto;
    expect(list.items.some((item) => item.fullName === CROSS_TENANT_CANDIDATE_NAME)).toBe(true);
  });

  it("a nonsense query returns an empty list with a 200, not a 404", async () => {
    const hr = await signInIntegrationClient("hr");
    const response = await hr.fetch(`/api/candidates?q=zzzznonexistentcandidatequery`);

    expect(response.status).toBe(200);
    const list = (await response.json()) as CandidateListDto;
    expect(list.items).toEqual([]);
    expect(list.truncated).toBe(false);
  });

  it("results are alphabetically ordered by full name", async () => {
    const hr = await signInIntegrationClient("hr");
    const response = await hr.fetch("/api/candidates");

    expect(response.status).toBe(200);
    const list = (await response.json()) as CandidateListDto;
    const names = list.items.map((item) => item.fullName);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("a query containing a literal % does not match every row -- the wildcard is escaped", async () => {
    const hr = await signInIntegrationClient("hr");
    const response = await hr.fetch(`/api/candidates?${new URLSearchParams({ q: "%%" }).toString()}`);

    expect(response.status).toBe(200);
    const list = (await response.json()) as CandidateListDto;
    expect(list.items).toEqual([]);
  });

  it("an invalid (too long) query is rejected with 422", async () => {
    const hr = await signInIntegrationClient("hr");
    const response = await hr.fetch(`/api/candidates?q=${"a".repeat(201)}`);

    expect(response.status).toBe(422);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("invalid_request");
  });
});
