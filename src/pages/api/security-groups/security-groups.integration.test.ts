/**
 * S-07's security boundary, proven against a real database: RLS denial on
 * every write path, the gate inside the search RPC, the unique constraints,
 * and the lockout invariant. Mirrors the structure of
 * authorization.integration.test.ts.
 *
 * Run against a real local Supabase stack and a running Astro server via
 * src/lib/test-support/integration-client.ts.
 *
 * Prerequisites (not started by this file):
 *   1. `npx supabase db reset --local` so the seeded principals exist
 *      (admin.test holds only group.manage, via the Administrator group;
 *      hr.test and no-group.test hold neither).
 *   2. A running Astro server at TEST_BASE_URL (default
 *      http://localhost:4321), e.g. `npm run dev` in a separate terminal.
 */
import { describe, expect, it } from "vitest";
import {
  getAccessTokenForRole,
  signInIntegrationClient,
  supabaseRestUrl,
  SUPABASE_ANON_KEY,
  type IntegrationClient,
} from "@/lib/test-support/integration-client";
import type { ApiErrorBody, SecurityGroupDetailDto, SecurityGroupDto, UserSearchResultDto } from "@/types";

async function createTestGroup(client: IntegrationClient, namePrefix: string): Promise<SecurityGroupDto> {
  const response = await client.fetch("/api/security-groups", {
    method: "POST",
    body: JSON.stringify({ name: `${namePrefix}-${Math.random().toString(36).slice(2)}` }),
  });
  if (response.status !== 201) {
    throw new Error(`createTestGroup: expected 201, got ${response.status}`);
  }
  return (await response.json()) as SecurityGroupDto;
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

const ADMIN_USER_ID = "33333333-3333-3333-3333-333333333333";
const HR_USER_ID = "11111111-1111-1111-1111-111111111111";

describe("admin group lifecycle: full success path as admin", () => {
  it("creates, renames, grants, revokes, adds a member, and removes them -- each observable on re-read", async () => {
    const admin = await signInIntegrationClient("admin");

    const created = await createTestGroup(admin, "lifecycle-group");

    const renameResponse = await admin.fetch(`/api/security-groups/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: `${created.name}-renamed` }),
    });
    expect(renameResponse.status).toBe(200);
    const renamed = (await renameResponse.json()) as SecurityGroupDto;
    expect(renamed.name).toBe(`${created.name}-renamed`);

    const detailAfterRename = await admin.fetch(`/api/security-groups/${created.id}`);
    expect(((await detailAfterRename.json()) as SecurityGroupDetailDto).name).toBe(`${created.name}-renamed`);

    const grantResponse = await admin.fetch(`/api/security-groups/${created.id}/operations`, {
      method: "POST",
      body: JSON.stringify({ operation: "candidate.read" }),
    });
    expect(grantResponse.status).toBe(200);
    expect(((await grantResponse.json()) as { operations: string[] }).operations).toContain("candidate.read");

    const detailAfterGrant = (await (
      await admin.fetch(`/api/security-groups/${created.id}`)
    ).json()) as SecurityGroupDetailDto;
    expect(detailAfterGrant.operations).toContain("candidate.read");

    const revokeResponse = await admin.fetch(`/api/security-groups/${created.id}/operations`, {
      method: "DELETE",
      body: JSON.stringify({ operation: "candidate.read" }),
    });
    expect(revokeResponse.status).toBe(200);
    expect(((await revokeResponse.json()) as { operations: string[] }).operations).not.toContain("candidate.read");

    const detailAfterRevoke = (await (
      await admin.fetch(`/api/security-groups/${created.id}`)
    ).json()) as SecurityGroupDetailDto;
    expect(detailAfterRevoke.operations).not.toContain("candidate.read");

    const addMemberResponse = await admin.fetch(`/api/security-groups/${created.id}/members`, {
      method: "POST",
      body: JSON.stringify({ userId: HR_USER_ID }),
    });
    expect(addMemberResponse.status).toBe(200);
    const membersAfterAdd = (await addMemberResponse.json()) as { members: { userId: string }[] };
    expect(membersAfterAdd.members.some((member) => member.userId === HR_USER_ID)).toBe(true);

    const detailAfterAdd = (await (
      await admin.fetch(`/api/security-groups/${created.id}`)
    ).json()) as SecurityGroupDetailDto;
    expect(detailAfterAdd.members.some((member) => member.userId === HR_USER_ID)).toBe(true);

    const removeMemberResponse = await admin.fetch(`/api/security-groups/${created.id}/members`, {
      method: "DELETE",
      body: JSON.stringify({ userId: HR_USER_ID }),
    });
    expect(removeMemberResponse.status).toBe(200);
    const membersAfterRemove = (await removeMemberResponse.json()) as { members: { userId: string }[] };
    expect(membersAfterRemove.members.some((member) => member.userId === HR_USER_ID)).toBe(false);

    const detailAfterRemove = (await (
      await admin.fetch(`/api/security-groups/${created.id}`)
    ).json()) as SecurityGroupDetailDto;
    expect(detailAfterRemove.members.some((member) => member.userId === HR_USER_ID)).toBe(false);
  }, 15000);
});

describe("admin group writes: denied for non-administrators, state unchanged", () => {
  interface DenialCase {
    name: string;
    request: (groupId: number) => { path: string; init: RequestInit };
  }

  const DENIAL_CASES: DenialCase[] = [
    {
      name: "POST /api/security-groups (create)",
      request: () => ({
        path: "/api/security-groups",
        init: { method: "POST", body: JSON.stringify({ name: `denial-probe-${Math.random().toString(36).slice(2)}` }) },
      }),
    },
    {
      name: "PATCH /api/security-groups/[id] (rename)",
      request: (groupId) => ({
        path: `/api/security-groups/${groupId}`,
        init: { method: "PATCH", body: JSON.stringify({ name: "renamed-by-non-admin" }) },
      }),
    },
    {
      name: "POST /api/security-groups/[id]/operations (grant)",
      request: (groupId) => ({
        path: `/api/security-groups/${groupId}/operations`,
        init: { method: "POST", body: JSON.stringify({ operation: "candidate.read" }) },
      }),
    },
    {
      name: "DELETE /api/security-groups/[id]/operations (revoke)",
      request: (groupId) => ({
        path: `/api/security-groups/${groupId}/operations`,
        init: { method: "DELETE", body: JSON.stringify({ operation: "candidate.read" }) },
      }),
    },
    {
      name: "POST /api/security-groups/[id]/members (add)",
      request: (groupId) => ({
        path: `/api/security-groups/${groupId}/members`,
        init: { method: "POST", body: JSON.stringify({ userId: HR_USER_ID }) },
      }),
    },
    {
      name: "DELETE /api/security-groups/[id]/members (remove)",
      request: (groupId) => ({
        path: `/api/security-groups/${groupId}/members`,
        init: { method: "DELETE", body: JSON.stringify({ userId: ADMIN_USER_ID }) },
      }),
    },
  ];

  it.each(DENIAL_CASES.flatMap((testCase) => (["hr", "noGroup"] as const).map((role) => ({ testCase, role }))))(
    "$testCase.name denies $role and leaves state unchanged",
    async ({ testCase, role }) => {
      const admin = await signInIntegrationClient("admin");
      const targetGroupId = await securityGroupIdByName(admin, "Hiring Manager");
      const detailBefore = (await (
        await admin.fetch(`/api/security-groups/${targetGroupId}`)
      ).json()) as SecurityGroupDetailDto;

      const principal = await signInIntegrationClient(role);
      const { path, init } = testCase.request(targetGroupId);
      const response = await principal.fetch(path, init);

      expect(response.status).toBe(403);
      const body = (await response.json()) as ApiErrorBody;
      expect(body.error.code).toBe("forbidden");

      const detailAfter = (await (
        await admin.fetch(`/api/security-groups/${targetGroupId}`)
      ).json()) as SecurityGroupDetailDto;
      expect(detailAfter).toEqual(detailBefore);
    },
  );
});

describe("uniqueness constraints", () => {
  it("creating a group with an existing name returns 422, not 500", async () => {
    const admin = await signInIntegrationClient("admin");
    const created = await createTestGroup(admin, "duplicate-name-probe");

    const duplicateResponse = await admin.fetch("/api/security-groups", {
      method: "POST",
      body: JSON.stringify({ name: created.name }),
    });

    expect(duplicateResponse.status).toBe(422);
    const body = (await duplicateResponse.json()) as ApiErrorBody;
    expect(body.error.code).toBe("invalid_request");
  });

  it("adding a user who is already a member returns 422, not 500", async () => {
    const admin = await signInIntegrationClient("admin");
    const created = await createTestGroup(admin, "duplicate-membership-probe");

    const firstAdd = await admin.fetch(`/api/security-groups/${created.id}/members`, {
      method: "POST",
      body: JSON.stringify({ userId: HR_USER_ID }),
    });
    expect(firstAdd.status).toBe(200);

    const secondAdd = await admin.fetch(`/api/security-groups/${created.id}/members`, {
      method: "POST",
      body: JSON.stringify({ userId: HR_USER_ID }),
    });
    expect(secondAdd.status).toBe(422);
    const body = (await secondAdd.json()) as ApiErrorBody;
    expect(body.error.code).toBe("invalid_request");
  });
});

// admin.test@example.com is seeded as the Administrator group's only
// member, and Administrator is the only group holding group.manage --
// so both directions of the lockout guard are reachable through this one
// fixture without any setup. Deliberately targets the seeded Administrator
// group rather than a throwaway one, per plan.md Phase 5's carve-out.
describe("lockout invariant: at least one group.manage holder must remain", () => {
  it("revoking group.manage from the only group holding it is refused with 422, state unchanged", async () => {
    const admin = await signInIntegrationClient("admin");
    const adminGroupId = await securityGroupIdByName(admin, "Administrator");

    const response = await admin.fetch(`/api/security-groups/${adminGroupId}/operations`, {
      method: "DELETE",
      body: JSON.stringify({ operation: "group.manage" }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("last_admin_required");

    const detail = (await (await admin.fetch(`/api/security-groups/${adminGroupId}`)).json()) as SecurityGroupDetailDto;
    expect(detail.operations).toContain("group.manage");
  });

  it("removing the last member of the only group.manage-holding group is refused with 422, state unchanged", async () => {
    const admin = await signInIntegrationClient("admin");
    const adminGroupId = await securityGroupIdByName(admin, "Administrator");

    const response = await admin.fetch(`/api/security-groups/${adminGroupId}/members`, {
      method: "DELETE",
      body: JSON.stringify({ userId: ADMIN_USER_ID }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("last_admin_required");

    const detail = (await (await admin.fetch(`/api/security-groups/${adminGroupId}`)).json()) as SecurityGroupDetailDto;
    expect(detail.members.some((member) => member.userId === ADMIN_USER_ID)).toBe(true);
  });
});

describe("user search: the enumeration boundary S-04 established", () => {
  it("a valid term returns matching users as admin", async () => {
    const admin = await signInIntegrationClient("admin");
    const response = await admin.fetch("/api/admin/users?q=hr.test");

    expect(response.status).toBe(200);
    const results = (await response.json()) as UserSearchResultDto[];
    expect(results.some((user) => user.email === "hr.test@example.com")).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["below-minimum", "h"],
  ] as const)("a %s term returns an empty array as admin", async (_label, term) => {
    const admin = await signInIntegrationClient("admin");
    const path = term === undefined ? "/api/admin/users" : `/api/admin/users?q=${encodeURIComponent(term)}`;
    const response = await admin.fetch(path);

    expect(response.status).toBe(200);
    const results = (await response.json()) as UserSearchResultDto[];
    expect(results).toEqual([]);
  });

  it("returns 403 as hr", async () => {
    const hr = await signInIntegrationClient("hr");
    const response = await hr.fetch("/api/admin/users?q=hr.test");

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("forbidden");
  });

  // No Astro route ever calls this function directly -- the app always
  // goes through GET /api/admin/users. Calling PostgREST directly as a
  // non-admin proves the guard lives inside the function itself, not only
  // at the route, matching the DELETE-half discipline in
  // authorization.integration.test.ts.
  it("direct PostgREST invocation of the search RPC as a non-admin is rejected", async () => {
    const hrToken = await getAccessTokenForRole("hr");

    const response = await fetch(supabaseRestUrl("/rpc/search_users_for_group_management"), {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${hrToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ search_term: "hr.test" }),
    });

    // PostgREST maps the standard insufficient_privilege errcode (42501)
    // to HTTP 403 regardless of how the exception was raised.
    expect(response.status).toBe(403);
  });
});
