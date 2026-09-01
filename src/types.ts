import { z } from "zod";

// `recruitments.status` is `text` + CHECK, not a Postgres enum, so the
// generated Database type emits `status: string`. This zod enum is the
// single source of truth for the allowed values across DTO typing,
// endpoint validation, and UI filter options. Any future migration
// touching the CHECK constraint must update this enum in the same commit.
export const recruitmentStatusSchema = z.enum(["draft", "live", "closed"]);
export type RecruitmentStatus = z.infer<typeof recruitmentStatusSchema>;

// Fixed list of employment types (FR-001). The `employment_type` column
// itself is free-text with no CHECK constraint (see recruitmentStatusSchema's
// comment above for the same drift-discipline concern) -- this zod enum is
// the single source of truth for the values the UI and API accept.
export const employmentTypeSchema = z.enum(["full-time", "part-time", "contract", "internship"]);
export type EmploymentType = z.infer<typeof employmentTypeSchema>;

export interface CreateRecruitmentCommand {
  title: string;
  department: string;
  location: string;
  employmentType: EmploymentType;
  openedAt: string;
  groupIds: number[];
}

export interface UpdateRecruitmentStatusCommand {
  status: RecruitmentStatus;
}

export interface RecruitmentStatusDto {
  id: number;
  status: RecruitmentStatus;
}

export interface RecruitmentListItemDto {
  id: number;
  title: string;
  department: string | null;
  location: string | null;
  openedAt: string | null;
  status: RecruitmentStatus;
  candidateCount: number;
}

export interface KanbanStageDto {
  id: number;
  name: string;
  sortOrder: number;
}

export interface CandidateCardDto {
  id: number;
  fullName: string;
  addedAt: string;
}

export interface KanbanBoardStageDto extends KanbanStageDto {
  candidateCount: number;
  candidates: CandidateCardDto[];
}

export interface KanbanBoardDto {
  recruitment: {
    id: number;
    title: string;
    status: RecruitmentStatus;
  };
  stages: KanbanBoardStageDto[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
