import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type {
  CandidateProfileDto,
  CandidateRecruitmentSummaryDto,
  CandidateStatusHistoryEntryDto,
  UpdateCandidateProfileCommand,
} from "@/types";
import { getLatestCvForProfile } from "@/lib/services/candidate-cv";

type Client = SupabaseClient<Database>;

interface CandidateRow {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  created_at: string;
}

interface RecruitmentSummaryRow {
  id: number;
  added_at: string;
  recruitment_id: number;
  recruitments: { title: string };
  kanban_stages: { name: string };
}

interface StatusHistoryRow {
  id: number;
  candidate_recruitment_id: number;
  changed_at: string;
  from_stage: { name: string } | null;
  to_stage: { name: string };
}

async function getStatusHistoryByRecruitment(
  client: Client,
  candidateRecruitmentIds: number[],
): Promise<Map<number, CandidateStatusHistoryEntryDto[]>> {
  const byRecruitment = new Map<number, CandidateStatusHistoryEntryDto[]>();

  if (candidateRecruitmentIds.length === 0) {
    return byRecruitment;
  }

  const { data: historyRows, error: historyError } = await client
    .from("candidate_recruitment_status_history")
    .select(
      "id, candidate_recruitment_id, changed_at, " +
        "from_stage:kanban_stages!candidate_recruitment_status_history_from_stage_id_fkey(name), " +
        "to_stage:kanban_stages!candidate_recruitment_status_history_to_stage_id_fkey(name)",
    )
    .in("candidate_recruitment_id", candidateRecruitmentIds)
    .order("changed_at", { ascending: true })
    .order("id", { ascending: true })
    .overrideTypes<StatusHistoryRow[], { merge: false }>();

  if (historyError) {
    throw historyError;
  }

  for (const row of historyRows) {
    const entry: CandidateStatusHistoryEntryDto = {
      id: row.id,
      fromStageName: row.from_stage?.name ?? null,
      toStageName: row.to_stage.name,
      changedAt: row.changed_at,
    };
    const existing = byRecruitment.get(row.candidate_recruitment_id);
    if (existing) {
      existing.push(entry);
    } else {
      byRecruitment.set(row.candidate_recruitment_id, [entry]);
    }
  }

  return byRecruitment;
}

export async function getCandidateProfile(client: Client, candidateId: number): Promise<CandidateProfileDto | null> {
  const { data: candidate, error: candidateError } = await client
    .from("candidates")
    .select("id, full_name, email, phone, created_at")
    .eq("id", candidateId)
    .maybeSingle<CandidateRow>();

  if (candidateError) {
    throw candidateError;
  }

  if (!candidate) {
    return null;
  }

  const { data: recruitmentRows, error: recruitmentsError } = await client
    .from("candidate_recruitments")
    .select("id, added_at, recruitment_id, recruitments(title), kanban_stages(name)")
    .eq("candidate_id", candidateId)
    .overrideTypes<RecruitmentSummaryRow[], { merge: false }>();

  if (recruitmentsError) {
    throw recruitmentsError;
  }

  const candidateRecruitmentIds = recruitmentRows.map((row) => row.id);
  const historyByRecruitment = await getStatusHistoryByRecruitment(client, candidateRecruitmentIds);

  const recruitments: CandidateRecruitmentSummaryDto[] = recruitmentRows.map((row) => ({
    recruitmentId: row.recruitment_id,
    candidateRecruitmentId: row.id,
    title: row.recruitments.title,
    stageName: row.kanban_stages.name,
    addedAt: row.added_at,
    history: historyByRecruitment.get(row.id) ?? [],
  }));

  const cv = await getLatestCvForProfile(client, candidateId);

  return {
    id: candidate.id,
    fullName: candidate.full_name,
    email: candidate.email,
    phone: candidate.phone,
    createdAt: candidate.created_at,
    recruitments,
    cv,
  };
}

export async function updateCandidateProfile(
  client: Client,
  candidateId: number,
  command: UpdateCandidateProfileCommand,
): Promise<CandidateProfileDto | null> {
  // `candidates.email` is deliberately excluded from the update payload --
  // it is the shared-profile dedup key (add_candidate_to_recruitment
  // matches on lower(email)), so this route can never change it even if a
  // caller smuggles it into the request body. `phone` is only included when
  // the caller supplied it, so omitting it leaves the stored value as-is
  // rather than clearing it.
  const { data: row, error } = await client
    .from("candidates")
    .update({ full_name: command.fullName, ...(command.phone !== undefined ? { phone: command.phone } : {}) })
    .eq("id", candidateId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!row) {
    return null;
  }

  return getCandidateProfile(client, candidateId);
}
