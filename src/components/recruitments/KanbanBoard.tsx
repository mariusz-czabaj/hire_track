import { useMemo } from "react";
import { useApiResource } from "@/components/hooks/useApiResource";
import { useMutation } from "@/components/hooks/useMutation";
import { ServerError } from "@/components/auth/ServerError";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { STATUS_PRESENTATION } from "@/lib/recruitment-status";
import {
  recruitmentStatusSchema,
  type KanbanBoardDto,
  type RecruitmentStatus,
  type RecruitmentStatusDto,
} from "@/types";

interface KanbanBoardProps {
  recruitmentId: string | undefined;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-CA");
}

function SkeletonColumns() {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="w-64 shrink-0 rounded-xl border border-white/10 bg-white/5 p-3">
          <Skeleton className="mb-3 h-5 w-24 bg-white/10" />
          <Skeleton className="mb-2 h-16 w-full rounded-lg bg-white/10" />
          <Skeleton className="h-16 w-full rounded-lg bg-white/10" />
        </div>
      ))}
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-10 text-center text-blue-100/70">
      <p className="mb-4">This recruitment could not be found.</p>
      <a href="/recruitments" className="text-sm text-purple-300 hover:underline">
        &larr; Back to recruitments
      </a>
    </div>
  );
}

function StatusControl({
  recruitmentId,
  status,
  onChanged,
}: {
  recruitmentId: string;
  status: RecruitmentStatus;
  onChanged: () => void;
}) {
  const {
    mutate,
    status: mutationStatus,
    error,
  } = useMutation<{ status: RecruitmentStatus }, RecruitmentStatusDto>(
    `/api/recruitments/${encodeURIComponent(recruitmentId)}`,
    "PATCH",
  );

  async function handleChange(next: RecruitmentStatus) {
    if (next === status) return;
    try {
      await mutate({ status: next });
      onChanged();
    } catch {
      // error state below renders the failure; nothing else to do here.
    }
  }

  return (
    <div className="flex items-center gap-2" data-testid="status-control">
      <div className="flex gap-1">
        {recruitmentStatusSchema.options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={mutationStatus === "loading"}
            onClick={() => {
              void handleChange(option);
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
              option === status
                ? "border-white/30 bg-white/20 text-white"
                : "border-white/10 bg-white/5 text-blue-100/70 hover:bg-white/10",
            )}
          >
            {STATUS_PRESENTATION[option].label}
          </button>
        ))}
      </div>
      {mutationStatus === "error" && <ServerError message={error} />}
    </div>
  );
}

export function KanbanBoard({ recruitmentId }: KanbanBoardProps) {
  const url = useMemo(() => `/api/recruitments/${encodeURIComponent(recruitmentId ?? "")}/board`, [recruitmentId]);
  const resource = useApiResource<KanbanBoardDto>(url);

  if (resource.status === "loading") {
    return <SkeletonColumns />;
  }

  if (resource.status === "not-found") {
    return <NotFoundState />;
  }

  if (resource.status === "error") {
    return <ServerError message={resource.message} />;
  }

  const { recruitment, stages } = resource.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-2xl font-bold text-transparent">
          {recruitment.title}
        </h1>
        <Badge variant={STATUS_PRESENTATION[recruitment.status].variant}>
          {STATUS_PRESENTATION[recruitment.status].label}
        </Badge>
        <StatusControl
          recruitmentId={String(recruitment.id)}
          status={recruitment.status}
          onChanged={() => {
            void resource.refetch();
          }}
        />
      </div>

      <div data-testid="kanban-columns" className="flex gap-4 overflow-x-auto pb-2">
        {stages.map((stage) => (
          <div key={stage.id} className="w-64 shrink-0 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-blue-100/90">{stage.name}</h2>
              <span className="text-xs text-blue-100/50">{stage.candidateCount}</span>
            </div>
            <div className="flex flex-col gap-2">
              {stage.candidates.length === 0 && (
                <p className="rounded-lg border border-dashed border-white/10 px-2 py-4 text-center text-xs text-blue-100/40">
                  No candidates
                </p>
              )}
              {stage.candidates.map((candidate) => (
                <Card key={candidate.id} className="gap-1 border-white/10 bg-white/10 p-3 text-white">
                  <p className="text-sm font-medium">{candidate.fullName}</p>
                  <p className="text-xs text-blue-100/60">Added {formatDate(candidate.addedAt)}</p>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
