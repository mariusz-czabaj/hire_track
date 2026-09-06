import { useEffect, useMemo, useState } from "react";
import { useApiResource } from "@/components/hooks/useApiResource";
import { useDebouncedValue } from "@/components/hooks/useDebouncedValue";
import { Alert } from "@/components/ui/alert";
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
        <label htmlFor="candidate-search" className="text-muted-foreground mb-1 block text-sm">
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
        />
      </div>

      {resource.status === "loading" && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      )}

      {resource.status === "success" && resource.data.items.length === 0 && (
        <p className="border-border bg-muted text-muted-foreground rounded-xl border px-4 py-6 text-center">
          No candidates match this search.
        </p>
      )}

      {resource.status === "success" && resource.data.items.length > 0 && (
        <div className="flex flex-col gap-3">
          {resource.data.items.map((candidate) => (
            <a key={candidate.id} href={`/candidates/${candidate.id}`} className="block">
              <Card className="hover:bg-accent relative flex flex-col gap-4 overflow-hidden border-0 p-4 pl-6 shadow-md transition-colors sm:flex-row sm:items-center sm:justify-between">
                <div className="bg-primary absolute inset-y-0 left-0 w-1.5" aria-hidden="true" />
                <div>
                  <p className="font-semibold">{candidate.fullName}</p>
                  <p className="text-muted-foreground text-sm">{candidate.email}</p>
                </div>
                <span className="text-muted-foreground text-sm">
                  {candidate.recruitmentCount} recruitment{candidate.recruitmentCount === 1 ? "" : "s"}
                </span>
              </Card>
            </a>
          ))}
          {resource.data.truncated && (
            <p className="text-muted-foreground text-center text-sm">
              Showing the first matches. Refine your search to narrow the list.
            </p>
          )}
        </div>
      )}

      {resource.status === "not-found" && <Alert variant="info" message="Candidates could not be found." />}
      {resource.status === "error" && <Alert variant="error" message={resource.message} />}
    </div>
  );
}
