import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import {
  recruitmentStatusSchema,
  type CreateRecruitmentCommand,
  type KanbanBoardDto,
  type RecruitmentListItemDto,
  type RecruitmentStatus,
  type RecruitmentStatusDto,
} from "@/types";

type Client = SupabaseClient<Database>;

interface RecruitmentListRow {
  id: number;
  title: string;
  department: string | null;
  location: string | null;
  opened_at: string | null;
  status: string;
  candidate_recruitments: { count: number }[];
}

function toRecruitmentStatus(status: string): RecruitmentStatus {
  const parsed = recruitmentStatusSchema.safeParse(status);
  return parsed.success ? parsed.data : "draft";
}

export async function listRecruitments(
  client: Client,
  { status }: { status?: RecruitmentStatus } = {},
): Promise<RecruitmentListItemDto[]> {
  let query = client
    .from("recruitments")
    .select("id, title, department, location, opened_at, status, candidate_recruitments(count)")
    .order("opened_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query.overrideTypes<RecruitmentListRow[], { merge: false }>();

  if (error) {
    throw error;
  }

  return data.map((row) => ({
    id: row.id,
    title: row.title,
    department: row.department,
    location: row.location,
    openedAt: row.opened_at,
    status: toRecruitmentStatus(row.status),
    candidateCount: row.candidate_recruitments[0]?.count ?? 0,
  }));
}

export async function createRecruitment(
  client: Client,
  command: CreateRecruitmentCommand,
): Promise<RecruitmentListItemDto> {
  const { data: recruitmentId, error: rpcError } = await client.rpc("create_recruitment", {
    p_title: command.title,
    p_department: command.department,
    p_location: command.location,
    p_employment_type: command.employmentType,
    p_opened_at: command.openedAt,
    p_group_ids: command.groupIds,
  });

  if (rpcError) {
    throw rpcError;
  }

  const { data: row, error: fetchError } = await client
    .from("recruitments")
    .select("id, title, department, location, opened_at, status")
    .eq("id", recruitmentId)
    .single();

  if (fetchError) {
    throw fetchError;
  }

  return {
    id: row.id,
    title: row.title,
    department: row.department,
    location: row.location,
    openedAt: row.opened_at,
    status: toRecruitmentStatus(row.status),
    candidateCount: 0,
  };
}

export async function updateRecruitmentStatus(
  client: Client,
  recruitmentId: number,
  status: RecruitmentStatus,
): Promise<RecruitmentStatusDto | null> {
  const { data: row, error } = await client
    .from("recruitments")
    .update({ status })
    .eq("id", recruitmentId)
    .select("id, status")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    status: toRecruitmentStatus(row.status),
  };
}

export async function getKanbanBoard(client: Client, recruitmentId: number): Promise<KanbanBoardDto | null> {
  const { data: recruitment, error: recruitmentError } = await client
    .from("recruitments")
    .select("id, title, status")
    .eq("id", recruitmentId)
    .maybeSingle();

  if (recruitmentError) {
    throw recruitmentError;
  }

  if (!recruitment) {
    return null;
  }

  const { data: stages, error: stagesError } = await client
    .from("kanban_stages")
    .select("id, name, sort_order")
    .is("recruitment_id", null)
    .order("sort_order", { ascending: true });

  if (stagesError) {
    throw stagesError;
  }

  const { data: candidateRows, error: candidatesError } = await client
    .from("candidate_recruitments")
    .select("current_stage_id, added_at, candidates(id, full_name)")
    .eq("recruitment_id", recruitmentId);

  if (candidatesError) {
    throw candidatesError;
  }

  const candidatesByStage = new Map<number, { id: number; fullName: string; addedAt: string }[]>();

  for (const row of candidateRows) {
    const bucket = candidatesByStage.get(row.current_stage_id) ?? [];
    bucket.push({ id: row.candidates.id, fullName: row.candidates.full_name, addedAt: row.added_at });
    candidatesByStage.set(row.current_stage_id, bucket);
  }

  return {
    recruitment: {
      id: recruitment.id,
      title: recruitment.title,
      status: toRecruitmentStatus(recruitment.status),
    },
    stages: stages.map((stage) => {
      const candidates = candidatesByStage.get(stage.id) ?? [];
      return {
        id: stage.id,
        name: stage.name,
        sortOrder: stage.sort_order,
        candidateCount: candidates.length,
        candidates,
      };
    }),
  };
}
