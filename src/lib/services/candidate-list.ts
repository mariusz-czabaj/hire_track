import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { CANDIDATE_LIST_RESULT_CAP, type CandidateListDto, type CandidateListItemDto } from "@/types";

type Client = SupabaseClient<Database>;

interface CandidateListRow {
  id: number;
  full_name: string;
  email: string;
  candidate_recruitments: { count: number }[];
}

// `full_name` is user-authored free text, and the substring is interpolated
// into a `like`/`ilike` pattern below -- an unescaped `%` or `_` turns the
// caller's search into a wildcard, widening the match far beyond what a
// name search should return.
function escapeLikePattern(raw: string): string {
  return raw.replace(/[%_]/g, (char) => `\\${char}`);
}

export interface ListCandidatesOptions {
  query?: string;
}

export async function listCandidates(client: Client, options: ListCandidatesOptions): Promise<CandidateListDto> {
  const trimmed = options.query?.trim() ?? "";

  let builder = client
    .from("candidates")
    .select("id, full_name, email, candidate_recruitments(count)")
    .order("full_name", { ascending: true })
    .order("id", { ascending: true })
    .limit(CANDIDATE_LIST_RESULT_CAP + 1);

  if (trimmed.length >= 2) {
    builder = builder.ilike("full_name", `%${escapeLikePattern(trimmed)}%`);
  }

  const { data, error } = await builder.overrideTypes<CandidateListRow[], { merge: false }>();

  if (error) {
    throw error;
  }

  const truncated = data.length > CANDIDATE_LIST_RESULT_CAP;
  const rows = truncated ? data.slice(0, CANDIDATE_LIST_RESULT_CAP) : data;

  const items: CandidateListItemDto[] = rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    recruitmentCount: row.candidate_recruitments[0]?.count ?? 0,
  }));

  return { items, truncated };
}
