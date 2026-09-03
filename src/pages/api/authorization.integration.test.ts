/**
 * The project's tenancy contract as one document: a request authenticated
 * as a non-member receives no rows and produces no write effect across
 * every domain endpoint. Organised by proposition (test-plan.md §2 risks
 * #1, #4, #5), not by route, so a reviewer can see every boundary at once
 * and a missing endpoint is visible by its absence from the table.
 *
 * Run against a real local Supabase stack and a running Astro server via
 * src/lib/test-support/integration-client.ts.
 *
 * Prerequisites (not started by this file):
 *   1. `npx supabase db reset --local` so the Phase 1 fixtures exist
 *      (tenant-peer, no-group, multi-group principals; the Data Analyst
 *      recruitment; see supabase/seed.sql).
 *   2. A running Astro server at TEST_BASE_URL (default
 *      http://localhost:4321), e.g. `npm run dev` in a separate terminal.
 *
 * Deliberately departs from cookbook §6.2's beside-the-route convention
 * -- see test-plan.md §6.2's carve-out, added in Phase 5.
 */
import { describe, expect, it } from "vitest";
import { signInIntegrationClient, type IntegrationClient } from "@/lib/test-support/integration-client";
import type { ApiErrorBody, KanbanBoardDto, RecruitmentListItemDto, SecurityGroupDto } from "@/types";

// The seeded recruitments' ids are resolved by title rather than assumed
// as ordinals -- seed.sql only guarantees the titles exist, and this suite
// must survive fixtures being appended further (plan.md Phase 1's own
// "look up by name" discipline for groups applies equally to recruitments
// here).
async function recruitmentIdByTitle(client: IntegrationClient, title: string): Promise<number> {
  const response = await client.fetch("/api/recruitments?status=all");
  const list = (await response.json()) as RecruitmentListItemDto[];
  const match = list.find((item) => item.title === title);
  if (!match) {
    throw new Error(`recruitmentIdByTitle: "${title}" not visible to this principal`);
  }
  return match.id;
}

async function candidateRecruitmentIdByName(
  client: IntegrationClient,
  recruitmentId: number,
  fullName: string,
): Promise<number> {
  const response = await client.fetch(`/api/recruitments/${recruitmentId}/board`);
  const board = (await response.json()) as KanbanBoardDto;
  for (const stage of board.stages) {
    const match = stage.candidates.find((candidate) => candidate.fullName === fullName);
    if (match) {
      return match.candidateRecruitmentId;
    }
  }
  throw new Error(`candidateRecruitmentIdByName: "${fullName}" not found on recruitment ${recruitmentId}'s board`);
}

describe("#1 cross-group read: symmetrical invisibility", () => {
  it("HR's recruitment list does not contain the Tenant B recruitment", async () => {
    const hr = await signInIntegrationClient("hr");
    const response = await hr.fetch("/api/recruitments?status=all");
    const list = (await response.json()) as RecruitmentListItemDto[];
    expect(list.some((item) => item.title === "Data Analyst")).toBe(false);
  });

  it("the tenant-peer's recruitment list does not contain Backend Engineer", async () => {
    const tenantPeer = await signInIntegrationClient("tenantPeer");
    const response = await tenantPeer.fetch("/api/recruitments?status=all");
    const list = (await response.json()) as RecruitmentListItemDto[];
    expect(list.some((item) => item.title === "Backend Engineer")).toBe(false);
  });
});

describe("#1 cross-group read: per-resource invisibility", () => {
  it("the tenant-peer gets 404 on Backend Engineer's board, while HR gets 200", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");

    const hrResponse = await hr.fetch(`/api/recruitments/${backendEngineerId}/board`);
    expect(hrResponse.status).toBe(200);

    const tenantPeer = await signInIntegrationClient("tenantPeer");
    const peerResponse = await tenantPeer.fetch(`/api/recruitments/${backendEngineerId}/board`);
    expect(peerResponse.status).toBe(404);
  });

  it("the tenant-peer gets 404 on Backend Engineer's stages, while HR gets 200", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");

    const hrResponse = await hr.fetch(`/api/recruitments/${backendEngineerId}/stages`);
    expect(hrResponse.status).toBe(200);

    const tenantPeer = await signInIntegrationClient("tenantPeer");
    const peerResponse = await tenantPeer.fetch(`/api/recruitments/${backendEngineerId}/stages`);
    expect(peerResponse.status).toBe(404);
  });

  it("the tenant-peer gets 404 on a Backend Engineer candidate detail, while HR gets 200", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");
    const annaId = await candidateRecruitmentIdByName(hr, backendEngineerId, "Anna Kowalska");

    const hrResponse = await hr.fetch(`/api/recruitments/${backendEngineerId}/candidates/${annaId}`);
    expect(hrResponse.status).toBe(200);

    const tenantPeer = await signInIntegrationClient("tenantPeer");
    const peerResponse = await tenantPeer.fetch(`/api/recruitments/${backendEngineerId}/candidates/${annaId}`);
    expect(peerResponse.status).toBe(404);
  });
});

describe("#1 cross-group read: the no-group floor case", () => {
  it("the no-group principal is authenticated but sees no recruitments", async () => {
    const noGroup = await signInIntegrationClient("noGroup");
    const response = await noGroup.fetch("/api/recruitments?status=all");
    expect(response.status).toBe(200);
    const list = (await response.json()) as RecruitmentListItemDto[];
    expect(list).toEqual([]);
  });

  it("the no-group principal gets 404 on every scoped resource", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");
    const annaId = await candidateRecruitmentIdByName(hr, backendEngineerId, "Anna Kowalska");

    const noGroup = await signInIntegrationClient("noGroup");
    const [board, stages, candidate] = await Promise.all([
      noGroup.fetch(`/api/recruitments/${backendEngineerId}/board`),
      noGroup.fetch(`/api/recruitments/${backendEngineerId}/stages`),
      noGroup.fetch(`/api/recruitments/${backendEngineerId}/candidates/${annaId}`),
    ]);

    expect(board.status).toBe(404);
    expect(stages.status).toBe(404);
    expect(candidate.status).toBe(404);
  });
});

describe("#1 cross-group read: the multi-group conjunct", () => {
  // The multi-group principal is a member of Hiring Manager
  // (recruitment.read, attached to Backend Engineer) *and* the Tenant B
  // fixture group (recruitment.write, attached only to Data Analyst).
  // has_recruitment_operation requires the operation-holding group to be
  // the *same* group attached to the recruitment (go.group_id =
  // rsg.group_id) -- so this principal must read Backend Engineer via
  // Hiring Manager's grant, but must not get write there merely by
  // holding recruitment.write in an unrelated attached-elsewhere group.
  // This conjunct was never exercised before Phase 1 added this fixture.
  it("reads Backend Engineer via the Hiring-Manager-equivalent membership", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");

    const multiGroup = await signInIntegrationClient("multiGroup");
    const response = await multiGroup.fetch(`/api/recruitments/${backendEngineerId}/board`);
    expect(response.status).toBe(200);
  });

  it("does not get write on Backend Engineer despite holding recruitment.write in an unattached group", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");

    const multiGroup = await signInIntegrationClient("multiGroup");
    const response = await multiGroup.fetch(`/api/recruitments/${backendEngineerId}/candidates`, {
      method: "POST",
      body: JSON.stringify({ fullName: "Should Fail", email: `multi-group-${Date.now()}@example.com` }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");
  });
});

describe("#4 shared candidate profile: the negative half (per-recruitment fields)", () => {
  // getCandidateDetail is already scoped by recruitment_id
  // (candidates.ts:107), so per-recruitment fields -- notes, status
  // history, current stage -- are unreachable to a non-member *by
  // construction*. The only HTTP-observable form of that is a 404 on the
  // scoped routes, asserted above under "per-resource invisibility" and
  // here restated against the read-holding (not write-holding) axis: a
  // principal with candidate.read who simply isn't a member of this
  // recruitment sees nothing from it, not a filtered/empty payload.
  it("a non-member with candidate.read sees a 404, never a filtered candidate-detail payload", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");
    const annaId = await candidateRecruitmentIdByName(hr, backendEngineerId, "Anna Kowalska");

    const tenantPeer = await signInIntegrationClient("tenantPeer");
    const response = await tenantPeer.fetch(`/api/recruitments/${backendEngineerId}/candidates/${annaId}`);
    expect(response.status).toBe(404);
  });
});

describe("#4 shared candidate profile: the positive half (org-wide identity)", () => {
  // Candidate identity (full name + email) is intentionally shared
  // org-wide -- prd.md:91 FR-007: the profile is shared, notes and status
  // are separate per recruitment. add_candidate_to_recruitment's PA003
  // (candidate_name_mismatch) check fires *after* the RPC's three
  // authorization checks (20260901210500_candidate_write_rpcs.sql:37-46,
  // 64-71), so this is reachable only by a caller who already holds
  // candidate.write on *some* recruitment -- the leak is bounded to
  // legitimate writers, and it is the only HTTP-observable proof that
  // identity crosses tenant boundaries while per-recruitment data does
  // not. This is intended behaviour, not a defect.
  it("a write-holder elsewhere gets candidate_name_mismatch against another tenant's existing candidate", async () => {
    const tenantPeer = await signInIntegrationClient("tenantPeer");
    const dataAnalystId = await recruitmentIdByTitle(tenantPeer, "Data Analyst");

    // anna.kowalska@example.com belongs to Backend Engineer (a recruitment
    // the tenant-peer cannot even see), under the name "Anna Kowalska".
    const response = await tenantPeer.fetch(`/api/recruitments/${dataAnalystId}/candidates`, {
      method: "POST",
      body: JSON.stringify({ fullName: "Someone Else Entirely", email: "anna.kowalska@example.com" }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("candidate_name_mismatch");
  });
});

describe("the unfiltered group list, pinned", () => {
  // security_groups_select is `using (true)` -- any authenticated
  // principal, including one in no group at all, sees the full list.
  // FR-001a needs the list at recruitment-creation time
  // (core-recruitment-data-foundation/plan.md:163). Asserting the exact
  // set (not just "it returns something") means an *unintentional*
  // widening elsewhere is caught, since this exposure is organisational
  // metadata (group names), not tenant data.
  it("returns the full group list, including to the no-group principal", async () => {
    const noGroup = await signInIntegrationClient("noGroup");
    const response = await noGroup.fetch("/api/security-groups");

    expect(response.status).toBe(200);
    const groups = (await response.json()) as SecurityGroupDto[];
    const names = groups.map((group) => group.name).sort();
    expect(names).toEqual(
      ["Administrator", "HR/Rekruter", "Hiring Manager", "Test Fixture -- Tenant B (HR-equivalent)"].sort(),
    );
  });
});
