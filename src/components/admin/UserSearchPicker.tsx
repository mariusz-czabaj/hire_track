import { useEffect, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { useDebouncedValue } from "@/components/hooks/useDebouncedValue";
import { Alert } from "@/components/ui/alert";
import type { UserSearchResultDto } from "@/types";

const MIN_QUERY_LENGTH = 2;

type FetchState =
  | { status: "loading" }
  | { status: "success"; data: UserSearchResultDto[] }
  | { status: "error"; message: string };

type SearchState = { status: "below-minimum" } | FetchState;

interface UserSearchPickerProps {
  existingUserIds: string[];
  onAdd: (user: UserSearchResultDto) => Promise<void>;
}

export function UserSearchPicker({ existingUserIds, onAdd }: UserSearchPickerProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const trimmedQuery = debouncedQuery.trim();
  const belowMinimum = trimmedQuery.length < MIN_QUERY_LENGTH;
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  useEffect(() => {
    // Per-run controller, not a shared ref: a ref reset at the top of each
    // effect run is un-set again before the previous run's in-flight request
    // settles, so a slow response for an older query could overwrite a newer
    // one. Aborting on cleanup makes the stale run unable to write state at
    // all, and cancels the request instead of just ignoring its result.
    const controller = new AbortController();

    if (belowMinimum) {
      return;
    }

    void (async () => {
      setFetchState({ status: "loading" });
      try {
        const response = await fetch(`/api/admin/users?q=${encodeURIComponent(trimmedQuery)}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          setFetchState({ status: "error", message: "Failed to search users." });
          return;
        }
        const data = (await response.json()) as UserSearchResultDto[];
        setFetchState({ status: "success", data });
      } catch (error) {
        // An aborted request is a superseded query, not a failure to report.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setFetchState({ status: "error", message: "Failed to search users." });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [belowMinimum, trimmedQuery]);

  const state: SearchState = belowMinimum ? { status: "below-minimum" } : fetchState;

  async function handleAdd(user: UserSearchResultDto) {
    setPendingUserId(user.id);
    try {
      await onAdd(user);
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <label htmlFor="user-search" className="sr-only">
          Search users by email
        </label>
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          id="user-search"
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Search users by email"
          className="border-input bg-input/30 text-foreground placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border py-2 pr-3 pl-10 focus:ring-2 focus:outline-none"
        />
      </div>

      {state.status === "below-minimum" && (
        <p className="text-muted-foreground text-xs">Type at least {MIN_QUERY_LENGTH} characters to search.</p>
      )}

      {state.status === "loading" && <p className="text-muted-foreground text-xs">Searching...</p>}

      {state.status === "success" && state.data.length === 0 && (
        <p className="text-muted-foreground text-xs">No matching users found.</p>
      )}

      {state.status === "success" && state.data.length > 0 && (
        <ul className="flex flex-col gap-1">
          {state.data.map((user) => {
            const alreadyMember = existingUserIds.includes(user.id);
            return (
              <li
                key={user.id}
                className="border-border bg-muted text-foreground flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
              >
                <span>{user.email}</span>
                {alreadyMember ? (
                  <span className="text-muted-foreground text-xs">Already a member</span>
                ) : (
                  <button
                    type="button"
                    disabled={pendingUserId === user.id}
                    onClick={() => {
                      void handleAdd(user);
                    }}
                    className="border-input bg-input/30 hover:bg-accent flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors disabled:opacity-50"
                  >
                    <UserPlus className="size-3.5" />
                    Add
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {state.status === "error" && <Alert variant="error" message={state.message} />}
    </div>
  );
}
