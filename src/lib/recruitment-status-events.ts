import type { RecruitmentStatus } from "@/types";

export const RECRUITMENT_STATUS_CHANGED_EVENT = "recruitment-status-changed";

export interface RecruitmentStatusChangedDetail {
  recruitmentId: string;
  status: RecruitmentStatus;
}

export function dispatchRecruitmentStatusChanged(detail: RecruitmentStatusChangedDetail): void {
  window.dispatchEvent(new CustomEvent<RecruitmentStatusChangedDetail>(RECRUITMENT_STATUS_CHANGED_EVENT, { detail }));
}
