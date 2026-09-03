import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { listCandidates } from "@/lib/services/candidate-list";
import { CANDIDATE_LIST_RESULT_CAP } from "@/types";

type Client = SupabaseClient<Database>;

interface QueryResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

interface CandidateListRow {
  id: number;
  full_name: string;
  email: string;
  candidate_recruitments: { count: number }[];
}

/**
 * Minimal stand-in for the PostgREST query builder chain, mirroring the
 * sibling services' FakeQueryBuilder -- but also records the `ilike`
 * pattern and the `order` call sequence so the cap and escaping contract
 * can be asserted directly, not just inferred from the returned rows.
 */
class FakeQueryBuilder<T> implements PromiseLike<QueryResult<T>> {
  public ilikeCalls: { column: string; pattern: string }[] = [];
  public orderCalls: { column: string; ascending: boolean | undefined }[] = [];
  public limitValue: number | undefined;

  constructor(private readonly result: QueryResult<T>) {}

  select(): this {
    return this;
  }

  ilike(column: string, pattern: string): this {
    this.ilikeCalls.push({ column, pattern });
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderCalls.push({ column, ascending: opts?.ascending });
    return this;
  }

  limit(value: number): this {
    this.limitValue = value;
    return this;
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

function makeListClient(result: QueryResult<CandidateListRow[]>): {
  client: Client;
  builder: FakeQueryBuilder<CandidateListRow[]>;
} {
  const builder = new FakeQueryBuilder<CandidateListRow[]>(result);
  const client = {
    from: (table: string) => {
      if (table === "candidates") {
        return builder;
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return { client: client as unknown as Client, builder };
}

function rows(count: number): CandidateListRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    full_name: `Candidate ${index + 1}`,
    email: `candidate-${index + 1}@example.com`,
    candidate_recruitments: [{ count: 1 }],
  }));
}

describe("listCandidates", () => {
  it("ignores a query shorter than two characters -- no ilike filter applied", async () => {
    const { client, builder } = makeListClient({ data: [], error: null });
    await listCandidates(client, { query: "a" });
    expect(builder.ilikeCalls).toEqual([]);
  });

  it("filters on full_name with wildcard characters escaped", async () => {
    const { client, builder } = makeListClient({ data: [], error: null });
    await listCandidates(client, { query: "100%_match" });
    expect(builder.ilikeCalls).toEqual([{ column: "full_name", pattern: "%100\\%\\_match%" }]);
  });

  it("orders alphabetically by full_name with an id tiebreak, ascending", async () => {
    const { client, builder } = makeListClient({ data: [], error: null });
    await listCandidates(client, { query: undefined });
    expect(builder.orderCalls).toEqual([
      { column: "full_name", ascending: true },
      { column: "id", ascending: true },
    ]);
  });

  it("requests cap + 1 rows", async () => {
    const { client, builder } = makeListClient({ data: [], error: null });
    await listCandidates(client, { query: undefined });
    expect(builder.limitValue).toBe(CANDIDATE_LIST_RESULT_CAP + 1);
  });

  it("sets truncated when exactly cap + 1 rows are returned, and trims to cap", async () => {
    const { client } = makeListClient({ data: rows(CANDIDATE_LIST_RESULT_CAP + 1), error: null });
    const result = await listCandidates(client, { query: undefined });
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(CANDIDATE_LIST_RESULT_CAP);
  });

  it("does not set truncated when fewer than cap + 1 rows are returned", async () => {
    const { client } = makeListClient({ data: rows(CANDIDATE_LIST_RESULT_CAP), error: null });
    const result = await listCandidates(client, { query: undefined });
    expect(result.truncated).toBe(false);
    expect(result.items).toHaveLength(CANDIDATE_LIST_RESULT_CAP);
  });

  it("maps rows into CandidateListItemDto, defaulting recruitmentCount to 0 when the count row is absent", async () => {
    const { client } = makeListClient({
      data: [{ id: 1, full_name: "Ada Lovelace", email: "ada@example.com", candidate_recruitments: [] }],
      error: null,
    });
    const result = await listCandidates(client, { query: undefined });
    expect(result.items).toEqual([{ id: 1, fullName: "Ada Lovelace", email: "ada@example.com", recruitmentCount: 0 }]);
  });

  it("propagates a query error as a throw", async () => {
    const { client } = makeListClient({ data: null, error: { message: "boom" } });
    await expect(listCandidates(client, { query: undefined })).rejects.toEqual({ message: "boom" });
  });
});
