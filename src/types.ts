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

export interface SecurityGroupDto {
  id: number;
  name: string;
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
  candidateRecruitmentId: number;
}

export interface KanbanBoardStageDto extends KanbanStageDto {
  candidateCount: number;
  candidates: CandidateCardDto[];
}

export interface ReplaceRecruitmentStagesCommand {
  stageNames: string[];
}

export interface RecruitmentStagesDto {
  stagesSource: "default" | "custom";
  stages: KanbanStageDto[];
}

export interface KanbanBoardDto {
  recruitment: {
    id: number;
    title: string;
    status: RecruitmentStatus;
  };
  stagesSource: "default" | "custom";
  stages: KanbanBoardStageDto[];
}

export interface AddCandidateCommand {
  fullName: string;
  email: string;
  phone?: string;
}

export interface MoveCandidateCommand {
  toStageId: number;
  note?: string;
}

export interface UpsertCandidateNoteCommand {
  stageId: number;
  body: string;
}

export interface CandidateNoteDto {
  stageId: number;
  stageName: string;
  body: string | null;
  authorEmail: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CandidateDetailDto {
  id: number;
  candidateId: number;
  fullName: string;
  email: string;
  phone: string | null;
  addedAt: string;
  currentStageId: number;
  notes: CandidateNoteDto[];
}

export interface UpdateCandidateProfileCommand {
  fullName: string;
  phone?: string;
}

export interface CandidateRecruitmentSummaryDto {
  recruitmentId: number;
  candidateRecruitmentId: number;
  title: string;
  stageName: string;
  addedAt: string;
}

// `cv` is always null until Phase 3 (CV upload) adds `CandidateCvDto`.
export interface CandidateProfileDto {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  recruitments: CandidateRecruitmentSummaryDto[];
  cv: null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
