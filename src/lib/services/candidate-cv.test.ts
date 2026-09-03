import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { purgeCvObjects } from "@/lib/services/candidate-cv";

type Client = SupabaseClient<Database>;

interface PurgeableRow {
  id: number;
  storage_path: string;
}

function makePurgeClient(config: {
  purgeable: PurgeableRow[];
  removeResult?: (path: string) => { error: { message: string } | null };
  markResult?: (id: number) => { error: { message: string } | null };
}) {
  const removeCalls: string[] = [];
  const markCalls: number[] = [];

  const client = {
    rpc: vi.fn((fn: string, args?: Record<string, unknown>) => {
      if (fn === "list_purgeable_candidate_cvs") {
        return Promise.resolve({ data: config.purgeable, error: null });
      }
      if (fn === "mark_candidate_cv_object_deleted") {
        const id = args?.target_cv_id as number;
        markCalls.push(id);
        const result = config.markResult?.(id) ?? { error: null };
        return Promise.resolve({ data: result.error ? null : { id }, error: result.error });
      }
      throw new Error(`Unexpected rpc: ${fn}`);
    }),
    storage: {
      from: () => ({
        remove: (paths: string[]) => {
          removeCalls.push(paths[0]);
          const result = config.removeResult?.(paths[0]) ?? { error: null };
          return Promise.resolve(result);
        },
      }),
    },
  } as unknown as Client;

  return { client, removeCalls, markCalls };
}

describe("purgeCvObjects", () => {
  it("removes the Storage object before marking the row deleted, for every purgeable row", async () => {
    const { client, removeCalls, markCalls } = makePurgeClient({
      purgeable: [
        { id: 1, storage_path: "1/a.pdf" },
        { id: 2, storage_path: "2/b.pdf" },
      ],
    });

    const summary = await purgeCvObjects(client);

    expect(removeCalls).toEqual(["1/a.pdf", "2/b.pdf"]);
    expect(markCalls).toEqual([1, 2]);
    expect(summary).toEqual({
      processed: 2,
      removed: 2,
      failed: 0,
      results: [
        { cvId: 1, storagePath: "1/a.pdf", removed: true },
        { cvId: 2, storagePath: "2/b.pdf", removed: true },
      ],
    });
  });

  it("does not call mark when the Storage delete fails, leaving the row eligible for the next run", async () => {
    const { client, markCalls } = makePurgeClient({
      purgeable: [{ id: 1, storage_path: "1/a.pdf" }],
      removeResult: () => ({ error: { message: "network error" } }),
    });

    const summary = await purgeCvObjects(client);

    expect(markCalls).toEqual([]);
    expect(summary).toEqual({
      processed: 1,
      removed: 0,
      failed: 1,
      results: [{ cvId: 1, storagePath: "1/a.pdf", removed: false, error: "Failed to remove file" }],
    });
  });

  it("treats a missing object (already removed by a prior run) as success", async () => {
    // The Supabase Storage `.remove()` call does not error on a
    // not-found key -- it simply omits it from the returned data -- so
    // a second purge run over the same row is harmless by construction:
    // no error means the mark step still runs.
    const { client, markCalls } = makePurgeClient({
      purgeable: [{ id: 1, storage_path: "1/a.pdf" }],
      removeResult: () => ({ error: null }),
    });

    const summary = await purgeCvObjects(client);

    expect(markCalls).toEqual([1]);
    expect(summary.removed).toBe(1);
  });

  it("continues to the next row when marking one row fails", async () => {
    const { client } = makePurgeClient({
      purgeable: [
        { id: 1, storage_path: "1/a.pdf" },
        { id: 2, storage_path: "2/b.pdf" },
      ],
      markResult: (id) => (id === 1 ? { error: { message: "row vanished" } } : { error: null }),
    });

    const summary = await purgeCvObjects(client);

    expect(summary.removed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.results.find((result) => result.cvId === 1)).toEqual({
      cvId: 1,
      storagePath: "1/a.pdf",
      removed: false,
      error: "Failed to record deletion",
    });
  });
});
