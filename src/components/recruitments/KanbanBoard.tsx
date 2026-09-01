import { useMemo } from "react";
import { useApiResource } from "@/components/hooks/useApiResource";
import { ServerError } from "@/components/auth/ServerError";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_PRESENTATION } from "@/lib/recruitment-status";
import type { KanbanBoardDto } from "@/types";

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
      <div className="flex items-center gap-3">
        <h1 className="bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-2xl font-bold text-transparent">
          {recruitment.title}
        </h1>
        <Badge variant={STATUS_PRESENTATION[recruitment.status].variant}>
          {STATUS_PRESENTATION[recruitment.status].label}
        </Badge>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2">
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
