import { useEffect, useRef, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { useDebouncedValue } from "@/components/hooks/useDebouncedValue";
import { ServerError } from "@/components/auth/ServerError";
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
  const ignoreRef = useRef(false);

  useEffect(() => {
    ignoreRef.current = false;
    if (belowMinimum) {
      return;
    }

    void (async () => {
      setFetchState({ status: "loading" });
      try {
        const response = await fetch(`/api/admin/users?q=${encodeURIComponent(trimmedQuery)}`);
        if (!response.ok) {
          if (!ignoreRef.current) setFetchState({ status: "error", message: "Failed to search users." });
          return;
        }
        const data = (await response.json()) as UserSearchResultDto[];
        if (!ignoreRef.current) setFetchState({ status: "success", data });
      } catch {
        if (!ignoreRef.current) setFetchState({ status: "error", message: "Failed to search users." });
      }
    })();

    return () => {
      ignoreRef.current = true;
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
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Search users by email"
          className="w-full rounded-lg border border-white/20 bg-white/10 py-2 pr-3 pl-10 text-white placeholder-white/40 focus:ring-2 focus:ring-purple-400 focus:outline-none"
        />
      </div>

      {state.status === "below-minimum" && (
        <p className="text-xs text-blue-100/50">Type at least {MIN_QUERY_LENGTH} characters to search.</p>
      )}

      {state.status === "loading" && <p className="text-xs text-blue-100/50">Searching...</p>}

      {state.status === "success" && state.data.length === 0 && (
        <p className="text-xs text-blue-100/50">No matching users found.</p>
      )}

      {state.status === "success" && state.data.length > 0 && (
        <ul className="flex flex-col gap-1">
          {state.data.map((user) => {
            const alreadyMember = existingUserIds.includes(user.id);
            return (
              <li
                key={user.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
              >
                <span>{user.email}</span>
                {alreadyMember ? (
                  <span className="text-xs text-blue-100/50">Already a member</span>
                ) : (
                  <button
                    type="button"
                    disabled={pendingUserId === user.id}
                    onClick={() => {
                      void handleAdd(user);
                    }}
                    className="flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-xs transition-colors hover:bg-white/20 disabled:opacity-50"
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

      {state.status === "error" && <ServerError message={state.message} />}
    </div>
  );
}
