import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { resolveKanbanStages } from "@/lib/services/recruitments";
import type {
  AddCandidateCommand,
  CandidateCardDto,
  CandidateDetailDto,
  CandidateNoteDto,
  MoveCandidateCommand,
  UpsertCandidateNoteCommand,
} from "@/types";

type Client = SupabaseClient<Database>;

export async function addCandidateToRecruitment(
  client: Client,
  recruitmentId: number,
  command: AddCandidateCommand,
): Promise<CandidateCardDto> {
  const { data, error } = await client.rpc("add_candidate_to_recruitment", {
    target_recruitment_id: recruitmentId,
    full_name: command.fullName,
    email: command.email,
    phone: command.phone,
  });

  if (error) {
    throw error;
  }

  // The RPC returns the candidate_recruitments row only (no candidates
  // columns), so fullName is derived from the submitted command -- the
  // RPC applies the same trim() before storing it.
  return {
    id: data.candidate_id,
    fullName: command.fullName.trim(),
    addedAt: data.added_at,
    candidateRecruitmentId: data.id,
  };
}

export async function moveCandidateStage(
  client: Client,
  recruitmentId: number,
  candidateRecruitmentId: number,
  command: MoveCandidateCommand,
): Promise<{ id: number; currentStageId: number } | null> {
  // Scope the candidate_recruitments row to the recruitment named in the
  // URL before calling the RPC -- move_candidate_stage resolves its own
  // recruitment from candidateRecruitmentId, so without this check a
  // caller could move a candidate via a mismatched [id] segment as long
  // as they hold recruitment.write on whichever recruitment the row
  // actually belongs to.
  const { data: scoped, error: scopeError } = await client
    .from("candidate_recruitments")
    .select("id")
    .eq("id", candidateRecruitmentId)
    .eq("recruitment_id", recruitmentId)
    .maybeSingle();

  if (scopeError) {
    throw scopeError;
  }

  if (!scoped) {
    return null;
  }

  const { data, error } = await client.rpc("move_candidate_stage", {
    target_candidate_recruitment_id: candidateRecruitmentId,
    to_stage_id: command.toStageId,
    note: command.note,
  });

  if (error) {
    throw error;
  }

  return { id: data.id, currentStageId: data.current_stage_id };
}

interface CandidateDetailRow {
  id: number;
  candidate_id: number;
  current_stage_id: number;
  added_at: string;
  candidates: { full_name: string; email: string; phone: string | null };
}

interface NoteRow {
  stage_id: number;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function getCandidateDetail(
  client: Client,
  recruitmentId: number,
  candidateRecruitmentId: number,
): Promise<CandidateDetailDto | null> {
  const { data: row, error: rowError } = await client
    .from("candidate_recruitments")
    .select("id, candidate_id, current_stage_id, added_at, candidates(full_name, email, phone)")
    .eq("id", candidateRecruitmentId)
    .eq("recruitment_id", recruitmentId)
    .maybeSingle<CandidateDetailRow>();

  if (rowError) {
    throw rowError;
  }

  if (!row) {
    return null;
  }

  const { stages } = await resolveKanbanStages(client, recruitmentId);

  const { data: noteRows, error: notesError } = await client
    .from("candidate_stage_notes")
    .select("stage_id, body, created_by, created_at, updated_at")
    .eq("candidate_recruitment_id", candidateRecruitmentId)
    .overrideTypes<NoteRow[], { merge: false }>();

  if (notesError) {
    throw notesError;
  }

  const notesByStage = new Map(noteRows.map((note) => [note.stage_id, note]));

  const authorIds = [...new Set(noteRows.map((note) => note.created_by).filter((id): id is string => id !== null))];
  const emailByAuthorId = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: users, error: usersError } = await client.rpc("get_user_emails", { user_ids: authorIds });
    if (usersError) {
      throw usersError;
    }
    for (const user of users) {
      emailByAuthorId.set(user.id, user.email);
    }
  }

  const notes: CandidateNoteDto[] = stages.map((stage) => {
    const note = notesByStage.get(stage.id);
    if (!note) {
      return {
        stageId: stage.id,
        stageName: stage.name,
        body: null,
        authorEmail: null,
        createdAt: null,
        updatedAt: null,
      };
    }
    return {
      stageId: stage.id,
      stageName: stage.name,
      body: note.body,
      authorEmail: note.created_by ? (emailByAuthorId.get(note.created_by) ?? null) : null,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
    };
  });

  return {
    id: row.id,
    candidateId: row.candidate_id,
    fullName: row.candidates.full_name,
    email: row.candidates.email,
    phone: row.candidates.phone,
    addedAt: row.added_at,
    currentStageId: row.current_stage_id,
    notes,
  };
}

export async function upsertCandidateNote(
  client: Client,
  recruitmentId: number,
  candidateRecruitmentId: number,
  command: UpsertCandidateNoteCommand,
): Promise<CandidateNoteDto | null> {
  const { data: scoped, error: scopeError } = await client
    .from("candidate_recruitments")
    .select("id")
    .eq("id", candidateRecruitmentId)
    .eq("recruitment_id", recruitmentId)
    .maybeSingle();

  if (scopeError) {
    throw scopeError;
  }

  if (!scoped) {
    return null;
  }

  // created_by is derived from the caller's own session, never from the
  // request body -- UpsertCandidateNoteCommand carries no author field,
  // so a client can never write a note under someone else's name.
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError) {
    throw userError;
  }

  const { data: stageRow, error: stageError } = await client
    .from("kanban_stages")
    .select("id, name")
    .eq("id", command.stageId)
    .maybeSingle();

  if (stageError) {
    throw stageError;
  }

  const { data, error } = await client
    .from("candidate_stage_notes")
    .upsert(
      {
        candidate_recruitment_id: candidateRecruitmentId,
        stage_id: command.stageId,
        body: command.body,
        created_by: user?.id ?? null,
      },
      { onConflict: "candidate_recruitment_id,stage_id" },
    )
    .select("stage_id, body, created_by, created_at, updated_at")
    .single<NoteRow>();

  if (error) {
    throw error;
  }

  return {
    stageId: data.stage_id,
    stageName: stageRow?.name ?? "",
    body: data.body,
    authorEmail: user?.email ?? null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}
