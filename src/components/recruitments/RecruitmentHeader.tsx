import { useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STATUS_PRESENTATION } from "@/lib/recruitment-status";
import { RECRUITMENT_STATUS_CHANGED_EVENT, type RecruitmentStatusChangedDetail } from "@/lib/recruitment-status-events";
import {
  RECRUITMENT_DETAILS_CHANGED_EVENT,
  type RecruitmentDetailsChangedDetail,
} from "@/lib/recruitment-details-events";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/employment-type";
import { EditRecruitmentDialog } from "@/components/recruitments/EditRecruitmentDialog";
import type { RecruitmentDetailDto } from "@/types";

interface RecruitmentHeaderProps {
  recruitment: RecruitmentDetailDto;
  canEdit: boolean;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-CA");
}

function buildMetadataEntries(recruitment: RecruitmentDetailDto): { label: string; value: string }[] {
  return [
    { label: "Department", value: recruitment.department },
    { label: "Location", value: recruitment.location },
    {
      label: "Employment type",
      value: recruitment.employmentType ? EMPLOYMENT_TYPE_LABELS[recruitment.employmentType] : null,
    },
    { label: "Opened", value: recruitment.openedAt ? formatDate(recruitment.openedAt) : null },
  ].filter((entry): entry is { label: string; value: string } => entry.value !== null);
}

// Owns the whole page-title block, previously static Astro markup, so it can
// repaint in place on either a status change (from KanbanBoard's StatusControl,
// a different island) or a details edit (from the dialog below), both of
// which can only reach this component via a window event, not React state.
export function RecruitmentHeader({ recruitment: initialRecruitment, canEdit }: RecruitmentHeaderProps) {
  const [recruitment, setRecruitment] = useState(initialRecruitment);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    function handleStatusChanged(event: Event) {
      const { detail } = event as CustomEvent<RecruitmentStatusChangedDetail>;
      if (detail.recruitmentId === String(recruitment.id)) {
        setRecruitment((prev) => ({ ...prev, status: detail.status }));
      }
    }

    function handleDetailsChanged(event: Event) {
      const { detail } = event as CustomEvent<RecruitmentDetailsChangedDetail>;
      if (detail.recruitmentId === String(recruitment.id)) {
        setRecruitment(detail.recruitment);
      }
    }

    window.addEventListener(RECRUITMENT_STATUS_CHANGED_EVENT, handleStatusChanged);
    window.addEventListener(RECRUITMENT_DETAILS_CHANGED_EVENT, handleDetailsChanged);
    return () => {
      window.removeEventListener(RECRUITMENT_STATUS_CHANGED_EVENT, handleStatusChanged);
      window.removeEventListener(RECRUITMENT_DETAILS_CHANGED_EVENT, handleDetailsChanged);
    };
  }, [recruitment.id]);

  const metadataEntries = buildMetadataEntries(recruitment);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-foreground text-2xl font-bold">{recruitment.title}</h1>
        <Badge variant={STATUS_PRESENTATION[recruitment.status].variant}>
          {STATUS_PRESENTATION[recruitment.status].label}
        </Badge>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" aria-label="Recruitment actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() => {
                  setDialogOpen(true);
                }}
              >
                Edit details
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {metadataEntries.length > 0 && (
        <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {metadataEntries.map((entry) => (
            <span key={entry.label}>
              <span className="font-medium">{entry.label}:</span> {entry.value}
            </span>
          ))}
        </div>
      )}

      {canEdit && (
        <EditRecruitmentDialog
          recruitment={recruitment}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSaved={setRecruitment}
        />
      )}
    </>
  );
}
