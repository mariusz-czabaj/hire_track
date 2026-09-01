import type { RecruitmentStatus } from "@/types";

export interface StatusFilterOption {
  label: string;
  value: RecruitmentStatus | undefined;
}

export const STATUS_FILTER_OPTIONS: StatusFilterOption[] = [
  { label: "All", value: undefined },
  { label: "Draft", value: "draft" },
  { label: "Live", value: "live" },
  { label: "Closed", value: "closed" },
];

export const STATUS_PRESENTATION: Record<
  RecruitmentStatus,
  { label: string; variant: "outline" | "default" | "secondary" }
> = {
  draft: { label: "Draft", variant: "outline" },
  live: { label: "Live", variant: "default" },
  closed: { label: "Closed", variant: "secondary" },
};
