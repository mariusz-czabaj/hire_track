import { useMemo } from "react";
import { useApiResource } from "@/components/hooks/useApiResource";
import { useMutation } from "@/components/hooks/useMutation";
import { ServerError } from "@/components/auth/ServerError";
import { AddCandidateDialog } from "@/components/recruitments/AddCandidateDialog";
import { MoveCandidateDialog } from "@/components/recruitments/MoveCandidateDialog";
import { StageEditor } from "@/components/recruitments/StageEditor";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { STATUS_PRESENTATION } from "@/lib/recruitment-status";
import { stageClassesForSortOrder } from "@/lib/stage-palette";
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
        <div key={i} className="min-w-48 flex-1 shrink-0">
          <Skeleton className="mb-3 h-8 w-full rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="border-border bg-muted text-muted-foreground rounded-xl border px-4 py-10 text-center">
      <p className="mb-4">This recruitment could not be found.</p>
      <a href="/recruitments" className="text-primary text-sm hover:underline">
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
            aria-pressed={option === status}
            onClick={() => {
              void handleChange(option);
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
              option === status
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
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

  const { recruitment, stages, stagesSource } = resource.data;

  function handleChanged() {
    void resource.refetch();
  }

  const cardIndexById = new Map(
    stages
      .flatMap((stage) => stage.candidates)
      .map((candidate, index) => [candidate.candidateRecruitmentId, index + 1]),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={STATUS_PRESENTATION[recruitment.status].variant}>
          {STATUS_PRESENTATION[recruitment.status].label}
        </Badge>
        <StatusControl recruitmentId={String(recruitment.id)} status={recruitment.status} onChanged={handleChanged} />
        <StageEditor
          recruitmentId={String(recruitment.id)}
          stages={stages}
          stagesSource={stagesSource}
          onChanged={handleChanged}
        />
        <AddCandidateDialog recruitmentId={String(recruitment.id)} onChanged={handleChanged} />
      </div>

      <div data-testid="kanban-columns" className="flex gap-4 overflow-x-auto pb-2">
        {stages.map((stage) => {
          const stageClasses = stageClassesForSortOrder(stage.sortOrder);
          const headingId = `stage-heading-${stage.id}`;
          return (
            <div key={stage.id} className="min-w-48 flex-1 shrink-0" role="region" aria-labelledby={headingId}>
              <div
                className={cn(
                  "mb-3 flex items-center justify-between gap-2 rounded-full px-3 py-1.5",
                  stageClasses.background,
                  stageClasses.foreground,
                )}
              >
                <h2 id={headingId} className="truncate text-xs font-bold tracking-wide uppercase">
                  {stage.name}
                </h2>
                <span className="text-xs font-bold">{stage.candidateCount}</span>
              </div>
              <div className="flex flex-col gap-2">
                {stage.candidates.length === 0 && (
                  <p className="border-border text-muted-foreground rounded-lg border border-dashed px-2 py-4 text-center text-xs">
                    No candidates
                  </p>
                )}
                {stage.candidates.map((candidate) => (
                  <Card key={candidate.id} className="relative gap-1 overflow-hidden border-0 p-3 pl-4 shadow-md">
                    <div
                      className={cn("absolute inset-y-0 left-0 w-1.5", stageClasses.background)}
                      aria-hidden="true"
                    />
                    <div className="flex items-start justify-between gap-2">
                      <a
                        href={`/recruitments/${recruitment.id}/candidates/${candidate.candidateRecruitmentId}`}
                        className="text-sm font-bold hover:underline"
                      >
                        {candidate.fullName}
                      </a>
                      <MoveCandidateDialog
                        recruitmentId={String(recruitment.id)}
                        candidateRecruitmentId={candidate.candidateRecruitmentId}
                        triggerLabel={`Move candidate ${cardIndexById.get(candidate.candidateRecruitmentId)}: ${candidate.fullName}`}
                        stages={stages}
                        onChanged={handleChanged}
                      />
                    </div>
                    <p className="text-muted-foreground text-right text-xs">Added {formatDate(candidate.addedAt)}</p>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
