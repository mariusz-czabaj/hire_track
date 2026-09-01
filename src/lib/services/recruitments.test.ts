import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import {
  createRecruitment,
  getKanbanBoard,
  listRecruitments,
  updateRecruitmentStatus,
} from "@/lib/services/recruitments";

type Client = SupabaseClient<Database>;

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/**
 * Minimal stand-in for the PostgREST query builder chain used by
 * `recruitments.ts`. Every chain method returns `this`; the chain
 * resolves via `then` (plain `await query`), `.maybeSingle()`, or
 * `.overrideTypes()`, all yielding the same fixed `result`.
 */
class FakeQueryBuilder<T> implements PromiseLike<QueryResult<T>> {
  constructor(private readonly result: QueryResult<T>) {}

  select(): this {
    return this;
  }

  order(): this {
    return this;
  }

  eq(): this {
    return this;
  }

  is(): this {
    return this;
  }

  update(): this {
    return this;
  }

  maybeSingle(): Promise<QueryResult<T>> {
    return Promise.resolve(this.result);
  }

  single(): Promise<QueryResult<T>> {
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

interface RecruitmentListRow {
  id: number;
  title: string;
  department: string | null;
  location: string | null;
  opened_at: string | null;
  status: string;
  candidate_recruitments: { count: number }[];
}

interface RecruitmentRow {
  id: number;
  title: string;
  status: string;
}

interface StageRow {
  id: number;
  recruitment_id: number | null;
  name: string;
  sort_order: number;
}

/**
 * Dedicated mock for the `kanban_stages` table: `getKanbanBoard` issues
 * two concurrent queries against it (one filtered with `.is()` for
 * defaults, one filtered with `.eq()` for overrides), so a shared
 * single-result `FakeQueryBuilder` can't tell them apart. A fresh
 * instance per `.from("kanban_stages")` call avoids a race between the
 * two chains over which filter was called last.
 */
class FakeKanbanStagesQueryBuilder implements PromiseLike<QueryResult<StageRow[]>> {
  private mode: "defaults" | "override" = "defaults";

  constructor(
    private readonly defaults: QueryResult<StageRow[]>,
    private readonly overrides: QueryResult<StageRow[]>,
  ) {}

  select(): this {
    return this;
  }

  order(): this {
    return this;
  }

  is(): this {
    this.mode = "defaults";
    return this;
  }

  eq(): this {
    this.mode = "override";
    return this;
  }

  then<TResult1 = QueryResult<StageRow[]>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<StageRow[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const result = this.mode === "override" ? this.overrides : this.defaults;
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

interface CandidateRecruitmentRow {
  current_stage_id: number;
  added_at: string;
  candidates: { id: number; full_name: string };
}

function buildRecruitmentListRow(overrides: Partial<RecruitmentListRow> = {}): RecruitmentListRow {
  return {
    id: 1,
    title: "Backend Engineer",
    department: "Engineering",
    location: "Remote",
    opened_at: "2026-01-01",
    status: "live",
    candidate_recruitments: [{ count: 5 }],
    ...overrides,
  };
}

function makeListClient(rows: RecruitmentListRow[], error: { message: string } | null = null): Client {
  return {
    from: () => new FakeQueryBuilder<RecruitmentListRow[]>({ data: error ? null : rows, error }),
  } as unknown as Client;
}

function makeBoardClient(config: {
  recruitment: QueryResult<RecruitmentRow>;
  defaultStages?: QueryResult<StageRow[]>;
  overrideStages?: QueryResult<StageRow[]>;
  candidateRows?: QueryResult<CandidateRecruitmentRow[]>;
}): Client {
  const { recruitment, defaultStages, overrideStages, candidateRows } = config;
  return {
    from: (table: string) => {
      if (table === "recruitments") {
        return new FakeQueryBuilder<RecruitmentRow>(recruitment);
      }
      if (table === "kanban_stages") {
        return new FakeKanbanStagesQueryBuilder(
          defaultStages ?? { data: [], error: null },
          overrideStages ?? { data: [], error: null },
        );
      }
      if (table === "candidate_recruitments") {
        return new FakeQueryBuilder<CandidateRecruitmentRow[]>(candidateRows ?? { data: [], error: null });
      }
      throw new Error(`Unexpected table in makeBoardClient: ${table}`);
    },
  } as unknown as Client;
}

interface CreateRecruitmentRow {
  id: number;
  title: string;
  department: string | null;
  location: string | null;
  opened_at: string | null;
  status: string;
}

function makeCreateClient(config: {
  rpc: { data: CreateRecruitmentRow | null; error: { message: string; code?: string } | null };
}): Client {
  return {
    rpc: () => Promise.resolve(config.rpc),
  } as unknown as Client;
}

function makeUpdateStatusClient(result: QueryResult<{ id: number; status: string }>): Client {
  return {
    from: () => new FakeQueryBuilder<{ id: number; status: string }>(result),
  } as unknown as Client;
}

describe("createRecruitment", () => {
  it("maps the RPC's returned row into a DTO with candidateCount 0", async () => {
    const client = makeCreateClient({
      rpc: {
        data: {
          id: 42,
          title: "Backend Engineer",
          department: "Engineering",
          location: "Remote",
          opened_at: "2026-01-01",
          status: "draft",
        },
        error: null,
      },
    });

    const dto = await createRecruitment(client, {
      title: "Backend Engineer",
      department: "Engineering",
      location: "Remote",
      employmentType: "full-time",
      openedAt: "2026-01-01",
      groupIds: [1],
    });

    expect(dto).toEqual({
      id: 42,
      title: "Backend Engineer",
      department: "Engineering",
      location: "Remote",
      openedAt: "2026-01-01",
      status: "draft",
      candidateCount: 0,
    });
  });

  it("propagates an RPC error as a throw", async () => {
    const client = makeCreateClient({
      rpc: { data: null, error: { message: "insufficient_privilege", code: "42501" } },
    });

    await expect(
      createRecruitment(client, {
        title: "Backend Engineer",
        department: "Engineering",
        location: "Remote",
        employmentType: "full-time",
        openedAt: "2026-01-01",
        groupIds: [1],
      }),
    ).rejects.toEqual({ message: "insufficient_privilege", code: "42501" });
  });
});

describe("updateRecruitmentStatus", () => {
  it("returns the updated status DTO on a match", async () => {
    const client = makeUpdateStatusClient({ data: { id: 1, status: "live" }, error: null });
    const dto = await updateRecruitmentStatus(client, 1, "live");
    expect(dto).toEqual({ id: 1, status: "live" });
  });

  it("returns null when no row matches (not found or not authorized)", async () => {
    const client = makeUpdateStatusClient({ data: null, error: null });
    const dto = await updateRecruitmentStatus(client, 999999, "live");
    expect(dto).toBeNull();
  });

  it("propagates a Supabase error as a throw", async () => {
    const client = makeUpdateStatusClient({ data: null, error: { message: "boom" } });
    await expect(updateRecruitmentStatus(client, 1, "live")).rejects.toEqual({ message: "boom" });
  });
});

describe("listRecruitments", () => {
  it("passes the status filter through", async () => {
    const client = makeListClient([buildRecruitmentListRow({ status: "draft" })]);
    const result = await listRecruitments(client, { status: "draft" });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("draft");
  });

  it("returns all rows on the unfiltered path", async () => {
    const client = makeListClient([buildRecruitmentListRow(), buildRecruitmentListRow({ id: 2 })]);
    const result = await listRecruitments(client);
    expect(result).toHaveLength(2);
  });

  it("maps snake_case rows to camelCase DTOs", async () => {
    const client = makeListClient([buildRecruitmentListRow()]);
    const [dto] = await listRecruitments(client);
    expect(dto).toEqual({
      id: 1,
      title: "Backend Engineer",
      department: "Engineering",
      location: "Remote",
      openedAt: "2026-01-01",
      status: "live",
      candidateCount: 5,
    });
  });

  it("derives the candidate count from candidate_recruitments, not candidates", async () => {
    const client = makeListClient([buildRecruitmentListRow({ candidate_recruitments: [{ count: 0 }] })]);
    const [dto] = await listRecruitments(client);
    expect(dto.candidateCount).toBe(0);
  });

  it("propagates a Supabase error as a throw", async () => {
    const client = makeListClient([], { message: "boom" });
    await expect(listRecruitments(client)).rejects.toEqual({ message: "boom" });
  });
});

describe("getKanbanBoard", () => {
  it("returns null when the recruitment is not visible or does not exist", async () => {
    const client = makeBoardClient({ recruitment: { data: null, error: null } });
    const result = await getKanbanBoard(client, 999999);
    expect(result).toBeNull();
  });

  it("renders a stage with zero candidates as an empty column", async () => {
    const client = makeBoardClient({
      recruitment: { data: { id: 1, title: "Backend Engineer", status: "live" }, error: null },
      defaultStages: {
        data: [
          { id: 10, recruitment_id: null, name: "New", sort_order: 1 },
          { id: 60, recruitment_id: null, name: "Rejected", sort_order: 6 },
        ],
        error: null,
      },
      candidateRows: {
        data: [{ current_stage_id: 10, added_at: "2026-01-02", candidates: { id: 100, full_name: "Ada Lovelace" } }],
        error: null,
      },
    });

    const board = await getKanbanBoard(client, 1);

    expect(board).not.toBeNull();
    const rejected = board?.stages.find((stage) => stage.name === "Rejected");
    expect(rejected).toBeDefined();
    expect(rejected?.candidateCount).toBe(0);
    expect(rejected?.candidates).toEqual([]);
  });

  it("preserves the sort_order-ascending order returned by the stages query", async () => {
    const client = makeBoardClient({
      recruitment: { data: { id: 1, title: "Backend Engineer", status: "live" }, error: null },
      defaultStages: {
        data: [
          { id: 10, recruitment_id: null, name: "New", sort_order: 1 },
          { id: 20, recruitment_id: null, name: "Screening", sort_order: 2 },
          { id: 60, recruitment_id: null, name: "Rejected", sort_order: 6 },
        ],
        error: null,
      },
    });

    const board = await getKanbanBoard(client, 1);
    expect(board?.stages.map((stage) => stage.name)).toEqual(["New", "Screening", "Rejected"]);
  });

  it("propagates a Supabase error as a throw", async () => {
    const client = makeBoardClient({ recruitment: { data: null, error: { message: "boom" } } });
    await expect(getKanbanBoard(client, 1)).rejects.toEqual({ message: "boom" });
  });

  it("falls back to the global defaults and reports stagesSource 'default' when no override rows exist", async () => {
    const client = makeBoardClient({
      recruitment: { data: { id: 1, title: "Backend Engineer", status: "live" }, error: null },
      defaultStages: {
        data: [
          { id: 10, recruitment_id: null, name: "New", sort_order: 1 },
          { id: 20, recruitment_id: null, name: "Screening", sort_order: 2 },
        ],
        error: null,
      },
      overrideStages: { data: [], error: null },
    });

    const board = await getKanbanBoard(client, 1);

    expect(board?.stagesSource).toBe("default");
    expect(board?.stages.map((stage) => stage.name)).toEqual(["New", "Screening"]);
  });

  it("resolves to only the override rows, sorted, and reports stagesSource 'custom' when overrides exist", async () => {
    const client = makeBoardClient({
      recruitment: { data: { id: 1, title: "Backend Engineer", status: "live" }, error: null },
      defaultStages: {
        data: [
          { id: 10, recruitment_id: null, name: "New", sort_order: 1 },
          { id: 20, recruitment_id: null, name: "Screening", sort_order: 2 },
        ],
        error: null,
      },
      overrideStages: {
        data: [
          { id: 101, recruitment_id: 1, name: "Applied", sort_order: 1 },
          { id: 102, recruitment_id: 1, name: "Tech Interview", sort_order: 2 },
        ],
        error: null,
      },
    });

    const board = await getKanbanBoard(client, 1);

    expect(board?.stagesSource).toBe("custom");
    expect(board?.stages.map((stage) => stage.name)).toEqual(["Applied", "Tech Interview"]);
  });

  it("places candidates on the correct override columns with accurate counts", async () => {
    const client = makeBoardClient({
      recruitment: { data: { id: 1, title: "Backend Engineer", status: "live" }, error: null },
      defaultStages: {
        data: [{ id: 10, recruitment_id: null, name: "New", sort_order: 1 }],
        error: null,
      },
      overrideStages: {
        data: [
          { id: 101, recruitment_id: 1, name: "Applied", sort_order: 1 },
          { id: 102, recruitment_id: 1, name: "Tech Interview", sort_order: 2 },
        ],
        error: null,
      },
      candidateRows: {
        data: [
          { current_stage_id: 101, added_at: "2026-01-02", candidates: { id: 100, full_name: "Ada Lovelace" } },
          { current_stage_id: 101, added_at: "2026-01-03", candidates: { id: 101, full_name: "Alan Turing" } },
        ],
        error: null,
      },
    });

    const board = await getKanbanBoard(client, 1);

    const applied = board?.stages.find((stage) => stage.name === "Applied");
    const techInterview = board?.stages.find((stage) => stage.name === "Tech Interview");
    expect(applied?.candidateCount).toBe(2);
    expect(applied?.candidates.map((c) => c.fullName)).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(techInterview?.candidateCount).toBe(0);
  });
});
