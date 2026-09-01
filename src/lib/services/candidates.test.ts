import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import {
  addCandidateToRecruitment,
  getCandidateDetail,
  moveCandidateStage,
  upsertCandidateNote,
} from "@/lib/services/candidates";

type Client = SupabaseClient<Database>;

interface QueryResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

/**
 * Minimal stand-in for the PostgREST query builder chain, extended from
 * the pattern in recruitments.test.ts:24-65 with `.upsert()` for the
 * note-editing path.
 */
class FakeQueryBuilder<T> implements PromiseLike<QueryResult<T>> {
  constructor(private readonly result: QueryResult<T>) {}

  select(): this {
    return this;
  }

  eq(): this {
    return this;
  }

  is(): this {
    return this;
  }

  upsert(): this {
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

interface StageRow {
  id: number;
  recruitment_id: number | null;
  name: string;
  sort_order: number;
}

/**
 * Mirrors recruitments.test.ts's FakeKanbanStagesQueryBuilder:
 * resolveKanbanStages issues two concurrent queries against
 * kanban_stages (`.is()` for defaults, `.eq()` for overrides), so a
 * shared single-result builder can't tell them apart.
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

function makeRpcClient(rpcResults: Record<string, QueryResult<unknown>>): Client {
  return {
    rpc: (fn: string) => Promise.resolve(rpcResults[fn]),
  } as unknown as Client;
}

function makeScopedRpcClient(config: {
  scope: QueryResult<{ id: number }>;
  rpc: QueryResult<unknown>;
  rpcName: string;
}): Client {
  return {
    from: (table: string) => {
      if (table === "candidate_recruitments") {
        return new FakeQueryBuilder<{ id: number }>(config.scope);
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc: (fn: string) => {
      if (fn === config.rpcName) {
        return Promise.resolve(config.rpc);
      }
      throw new Error(`Unexpected rpc: ${fn}`);
    },
  } as unknown as Client;
}

describe("addCandidateToRecruitment", () => {
  it("maps the RPC's returned row into a CandidateCardDto using the trimmed command name", async () => {
    const client = makeRpcClient({
      add_candidate_to_recruitment: {
        data: { id: 5, candidate_id: 42, recruitment_id: 1, current_stage_id: 10, added_at: "2026-01-02" },
        error: null,
      },
    });

    const dto = await addCandidateToRecruitment(client, 1, { fullName: "  Ada Lovelace  ", email: "ada@example.com" });

    expect(dto).toEqual({ id: 42, fullName: "Ada Lovelace", addedAt: "2026-01-02", candidateRecruitmentId: 5 });
  });

  it("propagates an RPC error as a throw", async () => {
    const client = makeRpcClient({
      add_candidate_to_recruitment: { data: null, error: { message: "insufficient_privilege", code: "42501" } },
    });

    await expect(addCandidateToRecruitment(client, 1, { fullName: "Ada", email: "ada@example.com" })).rejects.toEqual({
      message: "insufficient_privilege",
      code: "42501",
    });
  });
});

describe("moveCandidateStage", () => {
  it("returns null when the candidate_recruitment row is not scoped to the recruitment", async () => {
    const client = makeScopedRpcClient({
      scope: { data: null, error: null },
      rpc: { data: null, error: null },
      rpcName: "move_candidate_stage",
    });

    const result = await moveCandidateStage(client, 1, 999, { toStageId: 20 });
    expect(result).toBeNull();
  });

  it("propagates the scope-check error as a throw", async () => {
    const client = makeScopedRpcClient({
      scope: { data: null, error: { message: "boom" } },
      rpc: { data: null, error: null },
      rpcName: "move_candidate_stage",
    });

    await expect(moveCandidateStage(client, 1, 5, { toStageId: 20 })).rejects.toEqual({ message: "boom" });
  });

  it("calls the RPC and maps the result once the row is scoped", async () => {
    const client = makeScopedRpcClient({
      scope: { data: { id: 5 }, error: null },
      rpc: {
        data: { id: 5, candidate_id: 42, recruitment_id: 1, current_stage_id: 20, added_at: "2026-01-02" },
        error: null,
      },
      rpcName: "move_candidate_stage",
    });

    const result = await moveCandidateStage(client, 1, 5, { toStageId: 20, note: "Went well." });
    expect(result).toEqual({ id: 5, currentStageId: 20 });
  });

  it("propagates an RPC error (e.g. PA004 note_required) as a throw", async () => {
    const client = makeScopedRpcClient({
      scope: { data: { id: 5 }, error: null },
      rpc: { data: null, error: { message: "note_required", code: "PA004" } },
      rpcName: "move_candidate_stage",
    });

    await expect(moveCandidateStage(client, 1, 5, { toStageId: 20 })).rejects.toEqual({
      message: "note_required",
      code: "PA004",
    });
  });
});

describe("getCandidateDetail", () => {
  interface DetailRow {
    id: number;
    candidate_id: number;
    current_stage_id: number;
    added_at: string;
    candidates: { full_name: string; email: string; phone: string | null };
  }

  interface NoteRow {
    stage_id: number;
    body: string;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  }

  function makeDetailClient(config: {
    row: QueryResult<DetailRow>;
    defaultStages?: QueryResult<StageRow[]>;
    overrideStages?: QueryResult<StageRow[]>;
    notes?: QueryResult<NoteRow[]>;
    userEmails?: QueryResult<{ id: string; email: string }[]>;
  }): Client {
    return {
      from: (table: string) => {
        if (table === "candidate_recruitments") {
          return new FakeQueryBuilder<DetailRow>(config.row);
        }
        if (table === "kanban_stages") {
          return new FakeKanbanStagesQueryBuilder(
            config.defaultStages ?? { data: [], error: null },
            config.overrideStages ?? { data: [], error: null },
          );
        }
        if (table === "candidate_stage_notes") {
          return new FakeQueryBuilder<NoteRow[]>(config.notes ?? { data: [], error: null });
        }
        throw new Error(`Unexpected table: ${table}`);
      },
      rpc: (fn: string) => {
        if (fn === "get_user_emails_for_candidate") {
          return Promise.resolve(config.userEmails ?? { data: [], error: null });
        }
        throw new Error(`Unexpected rpc: ${fn}`);
      },
    } as unknown as Client;
  }

  it("returns null when no row is found or visible", async () => {
    const client = makeDetailClient({ row: { data: null, error: null } });
    const result = await getCandidateDetail(client, 1, 999);
    expect(result).toBeNull();
  });

  it("propagates the row query error as a throw", async () => {
    const client = makeDetailClient({ row: { data: null, error: { message: "boom" } } });
    await expect(getCandidateDetail(client, 1, 5)).rejects.toEqual({ message: "boom" });
  });

  it("lists every resolved stage with an empty-state note when nothing has been written yet", async () => {
    const client = makeDetailClient({
      row: {
        data: {
          id: 5,
          candidate_id: 42,
          current_stage_id: 10,
          added_at: "2026-01-02",
          candidates: { full_name: "Ada Lovelace", email: "ada@example.com", phone: null },
        },
        error: null,
      },
      defaultStages: {
        data: [
          { id: 10, recruitment_id: null, name: "New", sort_order: 1 },
          { id: 20, recruitment_id: null, name: "Screening", sort_order: 2 },
        ],
        error: null,
      },
    });

    const detail = await getCandidateDetail(client, 1, 5);

    expect(detail?.notes).toEqual([
      { stageId: 10, stageName: "New", body: null, authorEmail: null, createdAt: null, updatedAt: null },
      { stageId: 20, stageName: "Screening", body: null, authorEmail: null, createdAt: null, updatedAt: null },
    ]);
  });

  it("fills in the note body and resolved author email for a stage that has one", async () => {
    const client = makeDetailClient({
      row: {
        data: {
          id: 5,
          candidate_id: 42,
          current_stage_id: 10,
          added_at: "2026-01-02",
          candidates: { full_name: "Ada Lovelace", email: "ada@example.com", phone: null },
        },
        error: null,
      },
      defaultStages: {
        data: [{ id: 10, recruitment_id: null, name: "New", sort_order: 1 }],
        error: null,
      },
      notes: {
        data: [
          {
            stage_id: 10,
            body: "Strong candidate.",
            created_by: "11111111-1111-1111-1111-111111111111",
            created_at: "2026-01-02T10:00:00Z",
            updated_at: "2026-01-02T10:00:00Z",
          },
        ],
        error: null,
      },
      userEmails: { data: [{ id: "11111111-1111-1111-1111-111111111111", email: "hr.test@example.com" }], error: null },
    });

    const detail = await getCandidateDetail(client, 1, 5);

    expect(detail?.notes).toEqual([
      {
        stageId: 10,
        stageName: "New",
        body: "Strong candidate.",
        authorEmail: "hr.test@example.com",
        createdAt: "2026-01-02T10:00:00Z",
        updatedAt: "2026-01-02T10:00:00Z",
      },
    ]);
  });

  it("propagates a get_user_emails_for_candidate RPC error as a throw", async () => {
    const client = makeDetailClient({
      row: {
        data: {
          id: 5,
          candidate_id: 42,
          current_stage_id: 10,
          added_at: "2026-01-02",
          candidates: { full_name: "Ada Lovelace", email: "ada@example.com", phone: null },
        },
        error: null,
      },
      defaultStages: { data: [{ id: 10, recruitment_id: null, name: "New", sort_order: 1 }], error: null },
      notes: {
        data: [
          {
            stage_id: 10,
            body: "Strong candidate.",
            created_by: "11111111-1111-1111-1111-111111111111",
            created_at: "2026-01-02T10:00:00Z",
            updated_at: "2026-01-02T10:00:00Z",
          },
        ],
        error: null,
      },
      userEmails: { data: null, error: { message: "boom" } },
    });

    await expect(getCandidateDetail(client, 1, 5)).rejects.toEqual({ message: "boom" });
  });
});

describe("upsertCandidateNote", () => {
  interface NoteRow {
    stage_id: number;
    body: string;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  }

  function makeNoteClient(config: {
    scope: QueryResult<{ id: number }>;
    defaultStages?: QueryResult<StageRow[]>;
    overrideStages?: QueryResult<StageRow[]>;
    upsert?: QueryResult<NoteRow>;
    user?: { id: string; email: string } | null;
  }): Client {
    return {
      from: (table: string) => {
        if (table === "candidate_recruitments") {
          return new FakeQueryBuilder<{ id: number }>(config.scope);
        }
        if (table === "kanban_stages") {
          return new FakeKanbanStagesQueryBuilder(
            config.defaultStages ?? { data: [], error: null },
            config.overrideStages ?? { data: [], error: null },
          );
        }
        if (table === "candidate_stage_notes") {
          return new FakeQueryBuilder<NoteRow>(config.upsert ?? { data: null, error: null });
        }
        throw new Error(`Unexpected table: ${table}`);
      },
      auth: {
        getUser: () => Promise.resolve({ data: { user: config.user ?? null }, error: null }),
      },
    } as unknown as Client;
  }

  it("returns null when the candidate_recruitment row is not scoped to the recruitment", async () => {
    const client = makeNoteClient({ scope: { data: null, error: null } });
    const result = await upsertCandidateNote(client, 1, 999, { stageId: 10, body: "Note" });
    expect(result).toBeNull();
  });

  it("propagates the scope-check error as a throw", async () => {
    const client = makeNoteClient({ scope: { data: null, error: { message: "boom" } } });
    await expect(upsertCandidateNote(client, 1, 5, { stageId: 10, body: "Note" })).rejects.toEqual({ message: "boom" });
  });

  it("rejects a stageId that isn't part of the recruitment's resolved stage set", async () => {
    const client = makeNoteClient({
      scope: { data: { id: 5 }, error: null },
      defaultStages: { data: [{ id: 10, recruitment_id: null, name: "New", sort_order: 1 }], error: null },
    });

    await expect(upsertCandidateNote(client, 1, 5, { stageId: 999, body: "Note" })).rejects.toMatchObject({
      code: "22023",
      message: "Stage does not belong to this recruitment",
    });
  });

  it("upserts the note and attributes it to the caller's own session, never the request body", async () => {
    const client = makeNoteClient({
      scope: { data: { id: 5 }, error: null },
      defaultStages: { data: [{ id: 10, recruitment_id: null, name: "New", sort_order: 1 }], error: null },
      upsert: {
        data: {
          stage_id: 10,
          body: "Strong candidate.",
          created_by: "11111111-1111-1111-1111-111111111111",
          created_at: "2026-01-02T10:00:00Z",
          updated_at: "2026-01-02T10:00:00Z",
        },
        error: null,
      },
      user: { id: "11111111-1111-1111-1111-111111111111", email: "hr.test@example.com" },
    });

    const note = await upsertCandidateNote(client, 1, 5, { stageId: 10, body: "Strong candidate." });

    expect(note).toEqual({
      stageId: 10,
      stageName: "New",
      body: "Strong candidate.",
      authorEmail: "hr.test@example.com",
      createdAt: "2026-01-02T10:00:00Z",
      updatedAt: "2026-01-02T10:00:00Z",
    });
  });

  it("propagates an upsert error (e.g. RLS denial) as a throw", async () => {
    const client = makeNoteClient({
      scope: { data: { id: 5 }, error: null },
      defaultStages: { data: [{ id: 10, recruitment_id: null, name: "New", sort_order: 1 }], error: null },
      upsert: { data: null, error: { message: "insufficient_privilege", code: "42501" } },
      user: { id: "22222222-2222-2222-2222-222222222222", email: "hiring-manager.test@example.com" },
    });

    await expect(upsertCandidateNote(client, 1, 5, { stageId: 10, body: "Note" })).rejects.toEqual({
      message: "insufficient_privilege",
      code: "42501",
    });
  });
});
