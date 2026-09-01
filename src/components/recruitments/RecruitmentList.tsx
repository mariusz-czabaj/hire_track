import { useMemo, useState } from "react";
import { useApiResource } from "@/components/hooks/useApiResource";
import { ServerError } from "@/components/auth/ServerError";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_FILTER_OPTIONS, STATUS_PRESENTATION } from "@/lib/recruitment-status";
import { cn } from "@/lib/utils";
import { recruitmentStatusSchema, type RecruitmentListItemDto, type RecruitmentStatus } from "@/types";

interface RecruitmentListProps {
  initialStatus?: string;
}

function parseInitialStatus(value: string | undefined): RecruitmentStatus | undefined {
  const parsed = recruitmentStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-CA");
}

function buildUrl(status: RecruitmentStatus | undefined): string {
  return status ? `/api/recruitments?status=${status}` : "/api/recruitments";
}

function syncUrl(status: RecruitmentStatus | undefined): void {
  const url = new URL(window.location.href);
  if (status) {
    url.searchParams.set("status", status);
  } else {
    url.searchParams.delete("status");
  }
  window.history.replaceState(null, "", url);
}

export function RecruitmentList({ initialStatus }: RecruitmentListProps) {
  const [status, setStatus] = useState<RecruitmentStatus | undefined>(() => parseInitialStatus(initialStatus));
  const url = useMemo(() => buildUrl(status), [status]);
  const resource = useApiResource<RecruitmentListItemDto[]>(url);

  function handleFilterChange(next: RecruitmentStatus | undefined) {
    setStatus(next);
    syncUrl(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTER_OPTIONS.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => {
              handleFilterChange(option.value);
            }}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
              status === option.value
                ? "border-white/30 bg-white/20 text-white"
                : "border-white/10 bg-white/5 text-blue-100/70 hover:bg-white/10",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {resource.status === "loading" && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl bg-white/10" />
          ))}
        </div>
      )}

      {resource.status === "success" && resource.data.length === 0 && (
        <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-blue-100/70">
          {status ? "No recruitments match this filter." : "No recruitments are visible to you."}
        </p>
      )}

      {resource.status === "success" && resource.data.length > 0 && (
        <div className="flex flex-col gap-3">
          {resource.data.map((recruitment) => (
            <a key={recruitment.id} href={`/recruitments/${recruitment.id}`} className="block">
              <Card className="flex flex-row items-center justify-between gap-4 border-white/10 bg-white/10 p-4 text-white transition-colors hover:bg-white/15">
                <div>
                  <p className="font-semibold">{recruitment.title}</p>
                  <p className="text-sm text-blue-100/60">
                    {recruitment.department ?? "—"} · {recruitment.location ?? "—"}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-blue-100/60">{formatDate(recruitment.openedAt)}</span>
                  <span className="text-blue-100/60">{recruitment.candidateCount} candidates</span>
                  <Badge variant={STATUS_PRESENTATION[recruitment.status].variant}>
                    {STATUS_PRESENTATION[recruitment.status].label}
                  </Badge>
                </div>
              </Card>
            </a>
          ))}
        </div>
      )}

      {resource.status === "not-found" && <ServerError message="Recruitments could not be found." />}
      {resource.status === "error" && <ServerError message={resource.message} />}
    </div>
  );
}
