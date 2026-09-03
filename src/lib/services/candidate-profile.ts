import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { CandidateProfileDto, CandidateRecruitmentSummaryDto, UpdateCandidateProfileCommand } from "@/types";
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

  const recruitments: CandidateRecruitmentSummaryDto[] = recruitmentRows.map((row) => ({
    recruitmentId: row.recruitment_id,
    candidateRecruitmentId: row.id,
    title: row.recruitments.title,
    stageName: row.kanban_stages.name,
    addedAt: row.added_at,
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
