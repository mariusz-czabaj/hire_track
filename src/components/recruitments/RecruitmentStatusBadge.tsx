import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { STATUS_PRESENTATION } from "@/lib/recruitment-status";
import { RECRUITMENT_STATUS_CHANGED_EVENT, type RecruitmentStatusChangedDetail } from "@/lib/recruitment-status-events";
import type { RecruitmentStatus } from "@/types";

interface RecruitmentStatusBadgeProps {
  recruitmentId: string;
  initialStatus: RecruitmentStatus;
}

// Server-rendered next to the title, but kept live: KanbanBoard's status
// control lives in a separate client island further down the page, so a
// change there can only reach this badge via a window event, not React state.
export function RecruitmentStatusBadge({ recruitmentId, initialStatus }: RecruitmentStatusBadgeProps) {
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    function handleStatusChanged(event: Event) {
      const { detail } = event as CustomEvent<RecruitmentStatusChangedDetail>;
      if (detail.recruitmentId === recruitmentId) {
        setStatus(detail.status);
      }
    }

    window.addEventListener(RECRUITMENT_STATUS_CHANGED_EVENT, handleStatusChanged);
    return () => {
      window.removeEventListener(RECRUITMENT_STATUS_CHANGED_EVENT, handleStatusChanged);
    };
  }, [recruitmentId]);

  return <Badge variant={STATUS_PRESENTATION[status].variant}>{STATUS_PRESENTATION[status].label}</Badge>;
}
