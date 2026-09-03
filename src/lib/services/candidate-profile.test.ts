import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { getCandidateProfile, updateCandidateProfile } from "@/lib/services/candidate-profile";

type Client = SupabaseClient<Database>;

interface QueryResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

/**
 * Minimal stand-in for the PostgREST query builder chain, mirroring
 * candidates.test.ts's FakeQueryBuilder.
 */
class FakeQueryBuilder<T> implements PromiseLike<QueryResult<T>> {
  constructor(private readonly result: QueryResult<T>) {}

  select(): this {
    return this;
  }

  eq(): this {
    return this;
  }

  update(): this {
    return this;
  }

  maybeSingle(): Promise<QueryResult<T>> {
    return Promise.resolve(this.result);
  }

  overrideTypes(): Promise<QueryResult<T>> {
    return Promise.resolve(this.result);
  }

  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

interface CandidateRow {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  created_at: string;
}

interface RecruitmentSummaryRow {
  id: number;
  added_at: string;
  recruitment_id: number;
  recruitments: { title: string };
  kanban_stages: { name: string };
}

function makeProfileClient(config: {
  candidate: QueryResult<CandidateRow>;
  recruitments?: QueryResult<RecruitmentSummaryRow[]>;
  update?: QueryResult<{ id: number }>;
}): Client {
  // updateCandidateProfile issues an UPDATE against "candidates" first, then
  // (on success) calls getCandidateProfile, which issues a plain SELECT
  // against the same table -- so the first call must return `update` and
  // every subsequent call must return `candidate`.
  let candidatesCallCount = 0;
  return {
    from: (table: string) => {
      if (table === "candidates") {
        candidatesCallCount += 1;
        if (config.update !== undefined && candidatesCallCount === 1) {
          return new FakeQueryBuilder<{ id: number }>(config.update);
        }
        return new FakeQueryBuilder<CandidateRow>(config.candidate);
      }
      if (table === "candidate_recruitments") {
        return new FakeQueryBuilder<RecruitmentSummaryRow[]>(config.recruitments ?? { data: [], error: null });
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as Client;
}

describe("getCandidateProfile", () => {
  it("returns null when the candidate row is not found or visible", async () => {
    const client = makeProfileClient({ candidate: { data: null, error: null } });
    const result = await getCandidateProfile(client, 999);
    expect(result).toBeNull();
  });

  it("propagates the candidate query error as a throw", async () => {
    const client = makeProfileClient({ candidate: { data: null, error: { message: "boom" } } });
    await expect(getCandidateProfile(client, 5)).rejects.toEqual({ message: "boom" });
  });

  it("maps the candidate row and its recruitments into a CandidateProfileDto with cv always null", async () => {
    const client = makeProfileClient({
      candidate: {
        data: {
          id: 5,
          full_name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "555-0100",
          created_at: "2026-01-01",
        },
        error: null,
      },
      recruitments: {
        data: [
          {
            id: 10,
            added_at: "2026-01-02",
            recruitment_id: 1,
            recruitments: { title: "Backend Engineer" },
            kanban_stages: { name: "Screening" },
          },
        ],
        error: null,
      },
    });

    const profile = await getCandidateProfile(client, 5);

    expect(profile).toEqual({
      id: 5,
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "555-0100",
      createdAt: "2026-01-01",
      recruitments: [
        {
          recruitmentId: 1,
          candidateRecruitmentId: 10,
          title: "Backend Engineer",
          stageName: "Screening",
          addedAt: "2026-01-02",
        },
      ],
      cv: null,
    });
  });

  it("propagates the recruitments query error as a throw", async () => {
    const client = makeProfileClient({
      candidate: {
        data: { id: 5, full_name: "Ada Lovelace", email: "ada@example.com", phone: null, created_at: "2026-01-01" },
        error: null,
      },
      recruitments: { data: null, error: { message: "boom" } },
    });

    await expect(getCandidateProfile(client, 5)).rejects.toEqual({ message: "boom" });
  });
});

describe("updateCandidateProfile", () => {
  it("returns null when the update matches no visible row", async () => {
    const client = makeProfileClient({ candidate: { data: null, error: null }, update: { data: null, error: null } });
    const result = await updateCandidateProfile(client, 999, { fullName: "New Name" });
    expect(result).toBeNull();
  });

  it("propagates the update error (e.g. RLS denial) as a throw", async () => {
    const client = makeProfileClient({
      candidate: { data: null, error: null },
      update: { data: null, error: { message: "insufficient_privilege", code: "42501" } },
    });

    await expect(updateCandidateProfile(client, 5, { fullName: "New Name" })).rejects.toEqual({
      message: "insufficient_privilege",
      code: "42501",
    });
  });

  it("re-reads the profile after a successful update", async () => {
    const client = makeProfileClient({
      candidate: {
        data: {
          id: 5,
          full_name: "Updated Name",
          email: "ada@example.com",
          phone: "555-0199",
          created_at: "2026-01-01",
        },
        error: null,
      },
      recruitments: { data: [], error: null },
      update: { data: { id: 5 }, error: null },
    });

    const profile = await updateCandidateProfile(client, 5, { fullName: "Updated Name", phone: "555-0199" });

    expect(profile).toEqual({
      id: 5,
      fullName: "Updated Name",
      email: "ada@example.com",
      phone: "555-0199",
      createdAt: "2026-01-01",
      recruitments: [],
      cv: null,
    });
  });
});
