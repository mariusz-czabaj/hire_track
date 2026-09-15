import type { RecruitmentDetailDto } from "@/types";

export const RECRUITMENT_DETAILS_CHANGED_EVENT = "recruitment-details-changed";

export interface RecruitmentDetailsChangedDetail {
  recruitmentId: string;
  recruitment: RecruitmentDetailDto;
}

export function dispatchRecruitmentDetailsChanged(detail: RecruitmentDetailsChangedDetail): void {
  window.dispatchEvent(new CustomEvent<RecruitmentDetailsChangedDetail>(RECRUITMENT_DETAILS_CHANGED_EVENT, { detail }));
}
