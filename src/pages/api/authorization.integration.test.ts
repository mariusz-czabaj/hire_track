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
import {
  getAccessTokenForRole,
  signInIntegrationClient,
  supabaseRestUrl,
  SUPABASE_ANON_KEY,
  type IntegrationClient,
} from "@/lib/test-support/integration-client";
import type {
  ApiErrorBody,
  CandidateDetailDto,
  KanbanBoardDto,
  RecruitmentListItemDto,
  RecruitmentStagesDto,
  SecurityGroupDto,
} from "@/types";

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

async function stageIdByName(client: IntegrationClient, recruitmentId: number, name: string): Promise<number> {
  const response = await client.fetch(`/api/recruitments/${recruitmentId}/stages`);
  const stages = (await response.json()) as RecruitmentStagesDto;
  const match = stages.stages.find((stage) => stage.name === name);
  if (!match) {
    throw new Error(`stageIdByName: "${name}" not found on recruitment ${recruitmentId}'s stage set`);
  }
  return match.id;
}

async function securityGroupIdByName(client: IntegrationClient, name: string): Promise<number> {
  const response = await client.fetch("/api/security-groups");
  const groups = (await response.json()) as SecurityGroupDto[];
  const match = groups.find((group) => group.name === name);
  if (!match) {
    throw new Error(`securityGroupIdByName: no seeded security group named "${name}"`);
  }
  return match.id;
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

// The candidates list endpoint (S-06 plan.md Phase 3) is org-wide, gated
// only on the blanket candidate.read operation -- unlike every scoped
// recruitment/candidate-detail row above, there is no per-recruitment
// membership check here at all. That asymmetry is intentional (plan.md's
// "Key Discoveries") and belongs in this file's #4 grouping alongside the
// other shared-candidate-profile rows.
describe("#4 shared candidate profile: the candidates list endpoint", () => {
  it("a principal holding candidate.read finds the cross-tenant candidate by name regardless of group", async () => {
    const hr = await signInIntegrationClient("hr");
    const response = await hr.fetch("/api/candidates?q=Wojcik");

    expect(response.status).toBe(200);
    const list = (await response.json()) as { items: { fullName: string }[] };
    expect(list.items.some((item) => item.fullName === "Julia Wojcik")).toBe(true);
  });

  it("a principal without candidate.read receives no rows, while a legitimate principal still finds the candidate", async () => {
    const noGroup = await signInIntegrationClient("noGroup");
    const response = await noGroup.fetch("/api/candidates?q=Wojcik");

    expect(response.status).toBe(200);
    const list = (await response.json()) as { items: { fullName: string }[] };
    expect(list.items).toEqual([]);

    const hr = await signInIntegrationClient("hr");
    const readBack = await hr.fetch("/api/candidates?q=Wojcik");
    const readBackList = (await readBack.json()) as { items: { fullName: string }[] };
    expect(readBackList.items.some((item) => item.fullName === "Julia Wojcik")).toBe(true);
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

// #5 write surface -- refutes risk #5's named anti-pattern ("testing one
// write endpoint and generalising") by enumerating all seven write verbs
// as distinct table rows, each asserting a non-2xx response *and* a
// state read-back by the HR principal proving no write effect. The
// expected status varies by row -- 404 for the scoped-no-op routes
// (a null from a maybeSingle()-guarded lookup, or the RPC's own P0002
// "recruitment invisible" check firing before any write-privilege
// check), and 403 for the one row (POST /api/recruitments) that is
// gated purely on a blanket has_operation() check with no per-resource
// scoping to 404 against. This is mechanism-dependent, not an
// inconsistency to normalise away (plan.md Phase 3, Changes Required #1).
describe("#5 write surface: non-member denial across all seven write verbs", () => {
  interface WriteVerbCase {
    name: string;
    expectedStatus: number;
    principal: "tenantPeer" | "noGroup";
    request: (ctx: {
      backendEngineerId: number;
      annaId: number;
      newStageId: number;
      hrGroupId: number;
      probeMarker: string;
    }) => { path: string; init: RequestInit };
    readBack: (
      hr: IntegrationClient,
      ctx: { backendEngineerId: number; annaId: number; probeMarker: string },
    ) => Promise<void>;
  }

  // POST /api/recruitments is the one row where the tenant-peer
  // principal legitimately succeeds -- it holds blanket
  // recruitment.write via the Tenant B fixture group. The no-group
  // principal is asserted here instead, since it is the row's true
  // non-member analogue: lacking recruitment.write entirely, denied at
  // create_recruitment's blanket has_operation() check (42501), not at
  // a per-resource RLS boundary -- hence 403, not 404.
  const WRITE_VERB_CASES: WriteVerbCase[] = [
    {
      name: "POST /api/recruitments (no-group principal, no blanket recruitment.write)",
      expectedStatus: 403,
      principal: "noGroup",
      request: ({ hrGroupId, probeMarker }) => ({
        path: "/api/recruitments",
        init: {
          method: "POST",
          body: JSON.stringify({
            title: probeMarker,
            department: "Engineering",
            location: "Remote",
            employmentType: "full-time",
            openedAt: "2026-01-01",
            groupIds: [hrGroupId],
          }),
        },
      }),
      readBack: async (hr, { probeMarker }) => {
        const response = await hr.fetch("/api/recruitments?status=all");
        const list = (await response.json()) as RecruitmentListItemDto[];
        expect(list.some((item) => item.title === probeMarker)).toBe(false);
      },
    },
    {
      name: "PATCH /api/recruitments/[id]",
      expectedStatus: 404,
      principal: "tenantPeer",
      request: ({ backendEngineerId }) => ({
        path: `/api/recruitments/${backendEngineerId}`,
        init: { method: "PATCH", body: JSON.stringify({ status: "closed" }) },
      }),
      readBack: async (hr, { backendEngineerId }) => {
        const response = await hr.fetch("/api/recruitments?status=all");
        const list = (await response.json()) as RecruitmentListItemDto[];
        const match = list.find((item) => item.id === backendEngineerId);
        expect(match?.status).toBe("live");
      },
    },
    {
      name: "PUT /api/recruitments/[id]/stages",
      expectedStatus: 404,
      principal: "tenantPeer",
      request: ({ backendEngineerId }) => ({
        path: `/api/recruitments/${backendEngineerId}/stages`,
        init: { method: "PUT", body: JSON.stringify({ stages: [{ name: "Injected Stage" }] }) },
      }),
      readBack: async (hr, { backendEngineerId }) => {
        const response = await hr.fetch(`/api/recruitments/${backendEngineerId}/stages`);
        const stages = (await response.json()) as RecruitmentStagesDto;
        expect(stages.stagesSource).toBe("default");
        expect(stages.stages.some((stage) => stage.name === "Injected Stage")).toBe(false);
      },
    },
    {
      name: "DELETE /api/recruitments/[id]/stages",
      expectedStatus: 404,
      principal: "tenantPeer",
      request: ({ backendEngineerId }) => ({
        path: `/api/recruitments/${backendEngineerId}/stages`,
        init: { method: "DELETE" },
      }),
      readBack: async (hr, { backendEngineerId }) => {
        const response = await hr.fetch(`/api/recruitments/${backendEngineerId}/stages`);
        const stages = (await response.json()) as RecruitmentStagesDto;
        expect(stages.stagesSource).toBe("default");
      },
    },
    {
      name: "POST /api/recruitments/[id]/candidates",
      expectedStatus: 404,
      principal: "tenantPeer",
      request: ({ backendEngineerId, probeMarker }) => ({
        path: `/api/recruitments/${backendEngineerId}/candidates`,
        init: {
          method: "POST",
          body: JSON.stringify({ fullName: "Write Denial Probe", email: `${probeMarker}@example.com` }),
        },
      }),
      readBack: async (hr, { backendEngineerId }) => {
        const response = await hr.fetch(`/api/recruitments/${backendEngineerId}/board`);
        const board = (await response.json()) as KanbanBoardDto;
        const allCandidates = board.stages.flatMap((stage) => stage.candidates);
        expect(allCandidates.some((candidate) => candidate.fullName === "Write Denial Probe")).toBe(false);
      },
    },
    {
      name: "PATCH /api/recruitments/[id]/candidates/[candidateId]",
      expectedStatus: 404,
      principal: "tenantPeer",
      request: ({ backendEngineerId, annaId, newStageId }) => ({
        path: `/api/recruitments/${backendEngineerId}/candidates/${annaId}`,
        init: { method: "PATCH", body: JSON.stringify({ toStageId: newStageId, note: "Write denial probe" }) },
      }),
      readBack: async (hr, { backendEngineerId, annaId }) => {
        const response = await hr.fetch(`/api/recruitments/${backendEngineerId}/candidates/${annaId}`);
        const detail = (await response.json()) as CandidateDetailDto;
        expect(detail.fullName).toBe("Anna Kowalska");
        const newStageNote = detail.notes.find((note) => note.stageName === "New");
        expect(newStageNote?.body).toBeNull();
      },
    },
    {
      name: "PUT /api/recruitments/[id]/candidates/[candidateId]/notes",
      expectedStatus: 404,
      principal: "tenantPeer",
      request: ({ backendEngineerId, annaId, newStageId }) => ({
        path: `/api/recruitments/${backendEngineerId}/candidates/${annaId}/notes`,
        init: { method: "PUT", body: JSON.stringify({ stageId: newStageId, body: "Write denial probe" }) },
      }),
      readBack: async (hr, { backendEngineerId, annaId }) => {
        const response = await hr.fetch(`/api/recruitments/${backendEngineerId}/candidates/${annaId}`);
        const detail = (await response.json()) as CandidateDetailDto;
        const newStageNote = detail.notes.find((note) => note.stageName === "New");
        expect(newStageNote?.body).toBeNull();
      },
    },
  ];

  it.each(WRITE_VERB_CASES)("$name denies the non-member and leaves state unchanged", async (testCase) => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");
    const annaId = await candidateRecruitmentIdByName(hr, backendEngineerId, "Anna Kowalska");
    const newStageId = await stageIdByName(hr, backendEngineerId, "New");
    const hrGroupId = await securityGroupIdByName(hr, "HR/Rekruter");
    const probeMarker = `write-denial-probe-${Math.random().toString(36).slice(2)}`;

    const principal = await signInIntegrationClient(testCase.principal);
    const { path, init } = testCase.request({ backendEngineerId, annaId, newStageId, hrGroupId, probeMarker });
    const response = await principal.fetch(path, init);

    expect(response.status).toBe(testCase.expectedStatus);
    await testCase.readBack(hr, { backendEngineerId, annaId, probeMarker });
  });
});

// The second denial axis: sufficient tenancy, insufficient operation.
// The hiring-manager principal is a genuine member of Backend Engineer
// (recruitment.read + candidate.read), so a denial here can never be
// conflated with non-membership -- it is explicable only by the missing
// write operation. The recruitments-write rows for this axis already
// exist in index.integration.test.ts and are cross-referenced rather
// than duplicated here.
describe("#5 write surface: read-only principal denial (sufficient tenancy, insufficient operation)", () => {
  it("the hiring manager is denied PUT stages on its own recruitment", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");

    const hiringManager = await signInIntegrationClient("hiringManager");
    const response = await hiringManager.fetch(`/api/recruitments/${backendEngineerId}/stages`, {
      method: "PUT",
      body: JSON.stringify({ stages: [{ name: "Injected Stage" }] }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");

    const stagesResponse = await hr.fetch(`/api/recruitments/${backendEngineerId}/stages`);
    const stages = (await stagesResponse.json()) as RecruitmentStagesDto;
    expect(stages.stagesSource).toBe("default");
  });

  it("the hiring manager is denied DELETE stages on its own recruitment", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");

    const hiringManager = await signInIntegrationClient("hiringManager");
    const response = await hiringManager.fetch(`/api/recruitments/${backendEngineerId}/stages`, { method: "DELETE" });

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");
  });

  it("the hiring manager is denied POST candidates on its own recruitment", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");

    const hiringManager = await signInIntegrationClient("hiringManager");
    const probeEmail = `hm-write-denial-probe-${Math.random().toString(36).slice(2)}@example.com`;
    const response = await hiringManager.fetch(`/api/recruitments/${backendEngineerId}/candidates`, {
      method: "POST",
      body: JSON.stringify({ fullName: "HM Write Denial Probe", email: probeEmail }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");

    const boardResponse = await hr.fetch(`/api/recruitments/${backendEngineerId}/board`);
    const board = (await boardResponse.json()) as KanbanBoardDto;
    const allCandidates = board.stages.flatMap((stage) => stage.candidates);
    expect(allCandidates.some((candidate) => candidate.fullName === "HM Write Denial Probe")).toBe(false);
  });

  it("the hiring manager is denied PATCH (move stage) on a candidate in its own recruitment", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");
    const annaId = await candidateRecruitmentIdByName(hr, backendEngineerId, "Anna Kowalska");
    const screeningStageId = await stageIdByName(hr, backendEngineerId, "Screening");

    const hiringManager = await signInIntegrationClient("hiringManager");
    const response = await hiringManager.fetch(`/api/recruitments/${backendEngineerId}/candidates/${annaId}`, {
      method: "PATCH",
      body: JSON.stringify({ toStageId: screeningStageId, note: "HM write denial probe" }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");

    const detailResponse = await hr.fetch(`/api/recruitments/${backendEngineerId}/candidates/${annaId}`);
    const detail = (await detailResponse.json()) as CandidateDetailDto;
    expect(detail.currentStageId).not.toBe(screeningStageId);
  });

  it("the hiring manager is denied PUT notes on a candidate in its own recruitment", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");
    const annaId = await candidateRecruitmentIdByName(hr, backendEngineerId, "Anna Kowalska");
    const newStageId = await stageIdByName(hr, backendEngineerId, "New");

    const hiringManager = await signInIntegrationClient("hiringManager");
    const response = await hiringManager.fetch(`/api/recruitments/${backendEngineerId}/candidates/${annaId}/notes`, {
      method: "PUT",
      body: JSON.stringify({ stageId: newStageId, body: "HM write denial probe" }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");

    const detailResponse = await hr.fetch(`/api/recruitments/${backendEngineerId}/candidates/${annaId}`);
    const detail = (await detailResponse.json()) as CandidateDetailDto;
    const newStageNote = detail.notes.find((note) => note.stageName === "New");
    expect(newStageNote?.body).toBeNull();
  });
});

// Service-layer pre-checks that exist only in TypeScript and are
// therefore invisible to the SQL harness (supabase/tests/rls_verification.sql
// impersonates a role and runs SQL directly -- it cannot exercise a
// mismatched URL path segment, since that mismatch is a property of how
// the HTTP handler wires two path params together, not of the database
// state). These are the highest-value HTTP-only assertions in the
// phase: the two `[id]`/`[candidateId]` scoping pre-checks
// (candidates.ts:54-67, candidates.ts:187-199), the stageId
// cross-recruitment guard (candidates.ts:216-222), the session-derived
// note author invariant, and a characterization of the known
// to_stage_id gap.
describe("#5 write surface: service-layer pre-checks (HTTP-only, invisible to SQL impersonation)", () => {
  it("PATCH candidate 404s when [id] and [candidateId] belong to different recruitments", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");
    // hr does not hold recruitment.write -- or even read -- on Data
    // Analyst, so the tenant-peer client (a genuine member) resolves
    // the candidate id here; the assertion below is issued by hr, whose
    // real write is on Backend Engineer only. The mismatched
    // [id]=backendEngineerId segment must 404 before any RPC or RLS
    // check on Data Analyst is even reached, because moveCandidateStage's
    // own recruitment_id scoping (candidates.ts:54-67) finds no row
    // matching *both* candidateRecruitmentId and the URL's recruitment id.
    const tenantPeer = await signInIntegrationClient("tenantPeer");
    const dataAnalystId = await recruitmentIdByTitle(tenantPeer, "Data Analyst");
    const boardResponse = await tenantPeer.fetch(`/api/recruitments/${dataAnalystId}/board`);
    const board = (await boardResponse.json()) as KanbanBoardDto;
    const tomaszId = board.stages
      .flatMap((stage) => stage.candidates)
      .find((candidate) => candidate.fullName === "Tomasz Kaminski")?.candidateRecruitmentId;
    if (!tomaszId) {
      throw new Error("fixture gap: Tomasz Kaminski not found on Data Analyst's board");
    }
    const newStageId = await stageIdByName(hr, backendEngineerId, "New");

    const response = await hr.fetch(`/api/recruitments/${backendEngineerId}/candidates/${tomaszId}`, {
      method: "PATCH",
      body: JSON.stringify({ toStageId: newStageId, note: "mismatch probe" }),
    });

    expect(response.status).toBe(404);
  });

  it("PUT notes 404s when [id] and [candidateId] belong to different recruitments", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");
    const tenantPeer = await signInIntegrationClient("tenantPeer");
    const dataAnalystId = await recruitmentIdByTitle(tenantPeer, "Data Analyst");
    const boardResponse = await tenantPeer.fetch(`/api/recruitments/${dataAnalystId}/board`);
    const board = (await boardResponse.json()) as KanbanBoardDto;
    const tomaszId = board.stages
      .flatMap((stage) => stage.candidates)
      .find((candidate) => candidate.fullName === "Tomasz Kaminski")?.candidateRecruitmentId;
    if (!tomaszId) {
      throw new Error("fixture gap: Tomasz Kaminski not found on Data Analyst's board");
    }
    const newStageId = await stageIdByName(hr, backendEngineerId, "New");

    const response = await hr.fetch(`/api/recruitments/${backendEngineerId}/candidates/${tomaszId}/notes`, {
      method: "PUT",
      body: JSON.stringify({ stageId: newStageId, body: "mismatch probe" }),
    });

    expect(response.status).toBe(404);
  });

  it("PUT notes 422s with a stageId from another recruitment's resolved stage set", async () => {
    const hr = await signInIntegrationClient("hr");
    const hrGroupId = await securityGroupIdByName(hr, "HR/Rekruter");

    // A throwaway, test-created recruitment (never a seeded one -- see
    // plan.md Phase 4's discipline, applied here too since it also
    // mutates stage state). No candidates on it yet, so its stage set
    // can still be replaced with an override.
    const createResponse = await hr.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify({
        title: `stage-cross-recruitment-probe-${Math.random().toString(36).slice(2)}`,
        department: "Engineering",
        location: "Remote",
        employmentType: "full-time",
        openedAt: "2026-01-01",
        groupIds: [hrGroupId],
      }),
    });
    const created = (await createResponse.json()) as { id: number };
    // Off "draft" immediately -- tests/e2e/recruitments.spec.ts's status
    // filter assertion depends on the draft count, the same discipline
    // that spec's own beforeAll follows for recruitments it creates.
    await hr.fetch(`/api/recruitments/${created.id}`, { method: "PATCH", body: JSON.stringify({ status: "closed" }) });

    const stagesResponse = await hr.fetch(`/api/recruitments/${created.id}/stages`, {
      method: "PUT",
      body: JSON.stringify({ stages: [{ name: "Foreign Override Stage" }] }),
    });
    const stages = (await stagesResponse.json()) as RecruitmentStagesDto;
    const foreignStageId = stages.stages[0].id;

    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");
    const annaId = await candidateRecruitmentIdByName(hr, backendEngineerId, "Anna Kowalska");

    const response = await hr.fetch(`/api/recruitments/${backendEngineerId}/candidates/${annaId}/notes`, {
      method: "PUT",
      body: JSON.stringify({ stageId: foreignStageId, body: "cross-recruitment stage probe" }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("invalid_request");
  });

  it("a note's stored authorEmail is the caller's session identity, never a request-body value", async () => {
    const hr = await signInIntegrationClient("hr");
    const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");
    const piotrId = await candidateRecruitmentIdByName(hr, backendEngineerId, "Piotr Nowak");
    const screeningStageId = await stageIdByName(hr, backendEngineerId, "Screening");

    // UpsertCandidateNoteCommand carries no author field (types.ts:99),
    // so this extra key has no schema slot to land in -- created_by is
    // derived from the session (candidates.ts:202-208). Sending it
    // anyway pins that a future careless schema addition can't
    // accidentally start trusting it.
    const response = await hr.fetch(`/api/recruitments/${backendEngineerId}/candidates/${piotrId}/notes`, {
      method: "PUT",
      body: JSON.stringify({
        stageId: screeningStageId,
        body: "author invariant probe",
        authorEmail: "attacker@example.com",
      }),
    });

    expect(response.status).toBe(200);
    const note = (await response.json()) as { authorEmail: string | null };
    expect(note.authorEmail).toBe("hr.test@example.com");
  });

  // Characterization, not a fix: move_candidate_stage does not verify
  // that to_stage_id belongs to the target recruitment's own resolved
  // stage set. A *foreign override* stage is caught incidentally by the
  // BEFORE UPDATE consistency trigger (kanban_stage_customization
  // migration, :54-74) because its recruitment_id doesn't match the
  // candidate's own -- but a *global default* stage id is accepted
  // unconditionally, because default rows have recruitment_id null and
  // the trigger only compares when it's non-null. Both rows pin
  // whichever behaviour is current; neither endorses it as sufficient.
  describe("known gap: move_candidate_stage's to_stage_id is not scoped to the recruitment's own stage set", () => {
    it("moving to a foreign recruitment's override stage is rejected by the consistency trigger", async () => {
      const hr = await signInIntegrationClient("hr");
      const hrGroupId = await securityGroupIdByName(hr, "HR/Rekruter");

      const createA = await hr.fetch("/api/recruitments", {
        method: "POST",
        body: JSON.stringify({
          title: `stage-gap-probe-a-${Math.random().toString(36).slice(2)}`,
          department: "Engineering",
          location: "Remote",
          employmentType: "full-time",
          openedAt: "2026-01-01",
          groupIds: [hrGroupId],
        }),
      });
      const recruitmentA = (await createA.json()) as { id: number };
      await hr.fetch(`/api/recruitments/${recruitmentA.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "closed" }),
      });

      const createB = await hr.fetch("/api/recruitments", {
        method: "POST",
        body: JSON.stringify({
          title: `stage-gap-probe-b-${Math.random().toString(36).slice(2)}`,
          department: "Engineering",
          location: "Remote",
          employmentType: "full-time",
          openedAt: "2026-01-01",
          groupIds: [hrGroupId],
        }),
      });
      const recruitmentB = (await createB.json()) as { id: number };
      await hr.fetch(`/api/recruitments/${recruitmentB.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "closed" }),
      });

      await hr.fetch(`/api/recruitments/${recruitmentA.id}/stages`, {
        method: "PUT",
        body: JSON.stringify({ stages: [{ name: "A Stage One" }, { name: "A Stage Two" }] }),
      });
      const stagesBResponse = await hr.fetch(`/api/recruitments/${recruitmentB.id}/stages`, {
        method: "PUT",
        body: JSON.stringify({ stages: [{ name: "B Stage One" }] }),
      });
      const stagesB = (await stagesBResponse.json()) as RecruitmentStagesDto;
      const foreignOverrideStageId = stagesB.stages[0].id;

      const addResponse = await hr.fetch(`/api/recruitments/${recruitmentA.id}/candidates`, {
        method: "POST",
        body: JSON.stringify({
          fullName: "Stage Gap Probe",
          email: `stage-gap-probe-${Math.random().toString(36).slice(2)}@example.com`,
        }),
      });
      const added = (await addResponse.json()) as { candidateRecruitmentId: number };

      const moveResponse = await hr.fetch(
        `/api/recruitments/${recruitmentA.id}/candidates/${added.candidateRecruitmentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ toStageId: foreignOverrideStageId, note: "stage gap probe" }),
        },
      );

      expect(moveResponse.status).toBe(422);
      const body = (await moveResponse.json()) as ApiErrorBody;
      expect(body.error.code).toBe("invalid_request");
    });

    it("moving to a global default stage id is accepted unconditionally, regardless of the recruitment's own override set", async () => {
      const hr = await signInIntegrationClient("hr");
      const hrGroupId = await securityGroupIdByName(hr, "HR/Rekruter");

      const createResponse = await hr.fetch("/api/recruitments", {
        method: "POST",
        body: JSON.stringify({
          title: `stage-gap-probe-default-${Math.random().toString(36).slice(2)}`,
          department: "Engineering",
          location: "Remote",
          employmentType: "full-time",
          openedAt: "2026-01-01",
          groupIds: [hrGroupId],
        }),
      });
      const recruitment = (await createResponse.json()) as { id: number };
      await hr.fetch(`/api/recruitments/${recruitment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "closed" }),
      });

      await hr.fetch(`/api/recruitments/${recruitment.id}/stages`, {
        method: "PUT",
        body: JSON.stringify({ stages: [{ name: "Only Override Stage" }] }),
      });

      const addResponse = await hr.fetch(`/api/recruitments/${recruitment.id}/candidates`, {
        method: "POST",
        body: JSON.stringify({
          fullName: "Stage Gap Default Probe",
          email: `stage-gap-default-probe-${Math.random().toString(36).slice(2)}@example.com`,
        }),
      });
      const added = (await addResponse.json()) as { candidateRecruitmentId: number };

      // A global default stage's recruitment_id is null -- the
      // consistency trigger only compares when the stage's
      // recruitment_id is non-null, so this succeeds even though
      // "New" is not part of this recruitment's own override set.
      const backendEngineerId = await recruitmentIdByTitle(hr, "Backend Engineer");
      const defaultNewStageId = await stageIdByName(hr, backendEngineerId, "New");

      const moveResponse = await hr.fetch(
        `/api/recruitments/${recruitment.id}/candidates/${added.candidateRecruitmentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ toStageId: defaultNewStageId, note: "stage gap default probe" }),
        },
      );

      expect(moveResponse.status).toBe(200);
    });
  });
});

// Phase 4: characterization, not repair -- and, for the DELETE half, a
// correction of the plan's own premise, found by actually running the
// assertion rather than reasoning about the policy in isolation.
//
// recruitment_security_groups' INSERT and DELETE policies both check only
// the blanket has_operation('recruitment.write')
// (recruitment_security_groups_insert/_delete,
// 20260831183457_rls_policies.sql:155-160), with no membership check on the
// group being attached/detached. Read on their own, both rows look like the
// same accepted gap documented as "Decision: SKIPPED -- consistent with
// existing design, not a regression"
// (recruiter-creates-recruitment/reviews/impl-review.md:69-71).
//
// The INSERT half genuinely reproduces that gap. The DELETE half does not:
// PostgreSQL implicitly ANDs a table's SELECT policy into UPDATE/DELETE,
// because the row must be visible to be targeted in the first place. Since
// recruitment_security_groups_select IS scoped
// (has_recruitment_operation(id, 'recruitment.read')), it silently closes
// the gap the DELETE policy's blanket check would otherwise leave open --
// confirmed via EXPLAIN ANALYZE, which shows the SELECT policy's predicate
// ANDed into the DELETE's row filter. The plan and research.md both
// predicted this row would succeed; it does not, and the second test below
// pins the corrected, verified behaviour instead. A future change that
// removes recruitment_security_groups_select, or narrows it, should make
// that test fail -- it is the one guarding this now-confirmed-safe boundary.
describe("characterization (not a specification): unscoped recruitment_security_groups assignment", () => {
  it("INSERT half: a recruitment.write holder can scope a new recruitment to a group it does not belong to", async () => {
    // create_recruitment checks only the blanket recruitment.write
    // operation, never that the caller is a member of p_group_ids
    // (20260901150000_create_recruitment_returns_row.sql:26). This half has
    // a real chicken-and-egg justification: at the moment of creation the
    // recruitment doesn't exist yet, so the caller cannot already be scoped
    // to it.
    const tenantPeer = await signInIntegrationClient("tenantPeer");
    const hrGroupId = await securityGroupIdByName(tenantPeer, "HR/Rekruter");

    const response = await tenantPeer.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify({
        title: `characterization-insert-${Math.random().toString(36).slice(2)}`,
        department: "Engineering",
        location: "Remote",
        employmentType: "full-time",
        openedAt: "2026-01-01",
        groupIds: [hrGroupId],
      }),
    });

    expect(response.status).toBe(201);
  });

  it("DELETE half: a recruitment.write holder CANNOT detach a group from a recruitment it cannot read -- the SELECT policy silently closes the gap", async () => {
    // Verified finding, not a prediction from reading the policy in
    // isolation: recruitment_security_groups_delete's USING clause is the
    // same blanket has_operation('recruitment.write') check as INSERT, with
    // no membership check on the group being detached. Read alone, that
    // looks exploitable exactly like the INSERT half. It is not, because
    // PostgreSQL implicitly ANDs a table's SELECT policy into UPDATE/DELETE
    // -- a row must be visible before it can be targeted for either -- and
    // recruitment_security_groups_select IS scoped to
    // has_recruitment_operation(id, 'recruitment.read'). For hr (not a
    // member of the Tenant B fixture group), that conjunct is false, so the
    // DELETE removes zero rows even though the DELETE policy's own
    // predicate is true. Confirmed with EXPLAIN ANALYZE against this exact
    // query: the plan's Filter is
    // "(has_operation(...)) AND (has_recruitment_operation(..., 'recruitment.read'))",
    // the second conjunct coming from the SELECT policy, not the DELETE
    // policy shown in the migration file.
    //
    // No Astro route ever issues this DELETE -- the app has no
    // group-detach endpoint at all -- so this is the one assertion in the
    // suite that calls PostgREST directly instead of through the Astro
    // app, using a raw GoTrue access token
    // (integration-client.ts#getAccessTokenForRole). This is the "direct
    // PostgREST write path" research.md flagged for this row -- research.md
    // and plan.md both predicted this call would succeed; it does not, and
    // this test pins the corrected, empirically verified behaviour.
    //
    // Mutates seeded scoping, so it operates on a recruitment this test
    // creates itself -- never on Backend Engineer or Data Analyst --
    // per the plan's discipline for this phase.
    const tenantPeer = await signInIntegrationClient("tenantPeer");
    const tenantBGroupId = await securityGroupIdByName(tenantPeer, "Test Fixture -- Tenant B (HR-equivalent)");

    const createResponse = await tenantPeer.fetch("/api/recruitments", {
      method: "POST",
      body: JSON.stringify({
        title: `characterization-delete-${Math.random().toString(36).slice(2)}`,
        department: "Engineering",
        location: "Remote",
        employmentType: "full-time",
        openedAt: "2026-01-01",
        groupIds: [tenantBGroupId],
      }),
    });
    const created = (await createResponse.json()) as { id: number; title: string };

    // hr holds recruitment.write blanket but is not a member of the
    // Tenant B fixture group, so it cannot read the recruitment just
    // created -- confirming the "cannot read" half of the proposition
    // before the DELETE is even attempted.
    const hr = await signInIntegrationClient("hr");
    const hrListResponse = await hr.fetch("/api/recruitments?status=all");
    const hrList = (await hrListResponse.json()) as RecruitmentListItemDto[];
    expect(hrList.some((item) => item.id === created.id)).toBe(false);

    const hrToken = await getAccessTokenForRole("hr");
    const deleteResponse = await fetch(
      supabaseRestUrl(`/recruitment_security_groups?recruitment_id=eq.${created.id}&group_id=eq.${tenantBGroupId}`),
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${hrToken}`,
          Prefer: "return=representation",
        },
      },
    );

    expect(deleteResponse.status).toBe(200);
    const deletedRows = (await deleteResponse.json()) as { recruitment_id: number; group_id: number }[];
    expect(deletedRows).toHaveLength(0);

    // Effect, not just a status code: the tenant-peer principal who
    // created it is still its only member, and the recruitment is still
    // fully scoped -- the attempted detach left no trace.
    const tenantPeerListResponse = await tenantPeer.fetch("/api/recruitments?status=all");
    const tenantPeerList = (await tenantPeerListResponse.json()) as RecruitmentListItemDto[];
    expect(tenantPeerList.some((item) => item.id === created.id)).toBe(true);
  });
});
