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

  neq(): this {
    return this;
  }

  in(): this {
    return this;
  }

  order(): this {
    return this;
  }

  limit(): this {
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

interface StatusHistoryRow {
  id: number;
  candidate_recruitment_id: number;
  changed_at: string;
  from_stage: { name: string } | null;
  to_stage: { name: string };
}

function makeProfileClient(config: {
  candidate: QueryResult<CandidateRow>;
  recruitments?: QueryResult<RecruitmentSummaryRow[]>;
  history?: QueryResult<StatusHistoryRow[]>;
  update?: QueryResult<{ id: number }>;
  cv?: QueryResult<unknown>;
}): Client & { historyQueryCount: number } {
  // updateCandidateProfile issues an UPDATE against "candidates" first, then
  // (on success) calls getCandidateProfile, which issues a plain SELECT
  // against the same table -- so the first call must return `update` and
  // every subsequent call must return `candidate`.
  let candidatesCallCount = 0;
  const state = { historyQueryCount: 0 };
  const client = {
    get historyQueryCount() {
      return state.historyQueryCount;
    },
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
      if (table === "candidate_recruitment_status_history") {
        state.historyQueryCount += 1;
        return new FakeQueryBuilder<StatusHistoryRow[]>(config.history ?? { data: [], error: null });
      }
      if (table === "candidate_cvs") {
        // getLatestCvForProfile's own query chain (.order/.limit before
        // .maybeSingle) -- the FakeQueryBuilder's chain methods are all
        // pass-through, so no separate stub is needed for them.
        return new FakeQueryBuilder<unknown>(config.cv ?? { data: null, error: null });
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return client as unknown as Client & { historyQueryCount: number };
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

  it("maps the candidate row and its recruitments into a CandidateProfileDto, cv null when no CV row exists", async () => {
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
          history: [],
        },
      ],
      cv: null,
    });
  });

  it("issues no history query when the candidate has no visible recruitments", async () => {
    const client = makeProfileClient({
      candidate: {
        data: { id: 5, full_name: "Ada Lovelace", email: "ada@example.com", phone: null, created_at: "2026-01-01" },
        error: null,
      },
      recruitments: { data: [], error: null },
    });

    const profile = await getCandidateProfile(client, 5);

    expect(profile?.recruitments).toEqual([]);
    expect(client.historyQueryCount).toBe(0);
  });

  it("orders history entries oldest-first and renders a null source stage on the initial add", async () => {
    const client = makeProfileClient({
      candidate: {
        data: { id: 5, full_name: "Ada Lovelace", email: "ada@example.com", phone: null, created_at: "2026-01-01" },
        error: null,
      },
      recruitments: {
        data: [
          {
            id: 10,
            added_at: "2026-01-02",
            recruitment_id: 1,
            recruitments: { title: "Backend Engineer" },
            kanban_stages: { name: "Interview" },
          },
        ],
        error: null,
      },
      history: {
        data: [
          {
            id: 100,
            candidate_recruitment_id: 10,
            changed_at: "2026-01-02",
            from_stage: null,
            to_stage: { name: "New" },
          },
          {
            id: 101,
            candidate_recruitment_id: 10,
            changed_at: "2026-01-03",
            from_stage: { name: "New" },
            to_stage: { name: "Interview" },
          },
        ],
        error: null,
      },
    });

    const profile = await getCandidateProfile(client, 5);

    expect(profile?.recruitments[0].history).toEqual([
      { id: 100, fromStageName: null, toStageName: "New", changedAt: "2026-01-02" },
      { id: 101, fromStageName: "New", toStageName: "Interview", changedAt: "2026-01-03" },
    ]);
  });

  it("yields an empty history array for a recruitment with no history rows", async () => {
    const client = makeProfileClient({
      candidate: {
        data: { id: 5, full_name: "Ada Lovelace", email: "ada@example.com", phone: null, created_at: "2026-01-01" },
        error: null,
      },
      recruitments: {
        data: [
          {
            id: 10,
            added_at: "2026-01-02",
            recruitment_id: 1,
            recruitments: { title: "Backend Engineer" },
            kanban_stages: { name: "New" },
          },
        ],
        error: null,
      },
      history: { data: [], error: null },
    });

    const profile = await getCandidateProfile(client, 5);

    expect(profile?.recruitments[0].history).toEqual([]);
  });

  it("propagates the history query error as a throw", async () => {
    const client = makeProfileClient({
      candidate: {
        data: { id: 5, full_name: "Ada Lovelace", email: "ada@example.com", phone: null, created_at: "2026-01-01" },
        error: null,
      },
      recruitments: {
        data: [
          {
            id: 10,
            added_at: "2026-01-02",
            recruitment_id: 1,
            recruitments: { title: "Backend Engineer" },
            kanban_stages: { name: "New" },
          },
        ],
        error: null,
      },
      history: { data: null, error: { message: "boom" } },
    });

    await expect(getCandidateProfile(client, 5)).rejects.toEqual({ message: "boom" });
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
