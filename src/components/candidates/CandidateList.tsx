import { useEffect, useMemo, useState } from "react";
import { useApiResource } from "@/components/hooks/useApiResource";
import { useDebouncedValue } from "@/components/hooks/useDebouncedValue";
import { ServerError } from "@/components/auth/ServerError";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { CandidateListDto } from "@/types";

interface CandidateListProps {
  initialQuery?: string;
}

const SEARCH_DEBOUNCE_MS = 300;

function buildUrl(query: string): string {
  const trimmed = query.trim();
  return trimmed ? `/api/candidates?q=${encodeURIComponent(trimmed)}` : "/api/candidates";
}

function syncUrl(query: string): void {
  const trimmed = query.trim();
  const url = new URL(window.location.href);
  if (trimmed) {
    url.searchParams.set("q", trimmed);
  } else {
    url.searchParams.delete("q");
  }
  window.history.replaceState(null, "", url);
}

export function CandidateList({ initialQuery }: CandidateListProps) {
  const [term, setTerm] = useState(initialQuery ?? "");
  const debouncedTerm = useDebouncedValue(term, SEARCH_DEBOUNCE_MS);
  const url = useMemo(() => buildUrl(debouncedTerm), [debouncedTerm]);
  const resource = useApiResource<CandidateListDto>(url);

  useEffect(() => {
    syncUrl(debouncedTerm);
  }, [debouncedTerm]);

  return (
    <div className="flex flex-col gap-4" data-testid="candidate-list">
      <div>
        <label htmlFor="candidate-search" className="mb-1 block text-sm text-blue-100/80">
          Search by name
        </label>
        <Input
          id="candidate-search"
          name="candidate-search"
          type="text"
          aria-label="Search candidates by name"
          placeholder="Type a first or last name…"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
          }}
          className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
        />
      </div>

      {resource.status === "loading" && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl bg-white/10" />
          ))}
        </div>
      )}

      {resource.status === "success" && resource.data.items.length === 0 && (
        <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-blue-100/70">
          No candidates match this search.
        </p>
      )}

      {resource.status === "success" && resource.data.items.length > 0 && (
        <div className="flex flex-col gap-3">
          {resource.data.items.map((candidate) => (
            <a key={candidate.id} href={`/candidates/${candidate.id}`} className="block">
              <Card className="flex flex-row items-center justify-between gap-4 border-white/10 bg-white/10 p-4 text-white transition-colors hover:bg-white/15">
                <div>
                  <p className="font-semibold">{candidate.fullName}</p>
                  <p className="text-sm text-blue-100/60">{candidate.email}</p>
                </div>
                <span className="text-sm text-blue-100/60">
                  {candidate.recruitmentCount} recruitment{candidate.recruitmentCount === 1 ? "" : "s"}
                </span>
              </Card>
            </a>
          ))}
          {resource.data.truncated && (
            <p className="text-center text-sm text-blue-100/50">
              Showing the first matches. Refine your search to narrow the list.
            </p>
          )}
        </div>
      )}

      {resource.status === "not-found" && <ServerError message="Candidates could not be found." />}
      {resource.status === "error" && <ServerError message={resource.message} />}
    </div>
  );
}
