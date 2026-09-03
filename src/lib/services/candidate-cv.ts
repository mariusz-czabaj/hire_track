import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { CandidateCvDto, CreateCvUploadIntentCommand, CvPurgeSummaryDto, CvUploadIntentDto } from "@/types";

type Client = SupabaseClient<Database>;

const BUCKET = "candidate-cvs";

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

interface CandidateCvRow {
  id: number;
  candidate_id: number;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  uploaded_at: string;
  expires_at: string;
  object_deleted_at: string | null;
}

function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

// Server-derived path -- never taken from client input, since the path is
// fixed into the signature at mint time and is the only thing constraining
// where the bytes land (see plan.md's Critical Implementation Details).
function buildStoragePath(candidateId: number, cvId: number, mimeType: string): string {
  const extension = EXTENSION_BY_MIME_TYPE[mimeType] ?? "bin";
  return `${candidateId}/${cvId}-${randomToken()}.${extension}`;
}

function toCvDto(row: CandidateCvRow): CandidateCvDto {
  const expired = row.object_deleted_at !== null || new Date(row.expires_at).getTime() <= Date.now();
  return {
    id: row.id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
    expiresAt: row.expires_at,
    state: expired ? "expired" : "available",
  };
}

// Mint a signed upload URL for a new CV. Reaps stale pending rows for
// this candidate first -- a caller that abandons an upload (network
// failure, closed tab) would otherwise accumulate orphaned pending rows
// forever, since only 'active'/'superseded' rows are ever purged.
export async function createCvUploadIntent(
  client: Client,
  candidateId: number,
  command: CreateCvUploadIntentCommand,
): Promise<CvUploadIntentDto> {
  const { error: reapError } = await client
    .from("candidate_cvs")
    .delete()
    .eq("candidate_id", candidateId)
    .eq("status", "pending");

  if (reapError) {
    throw reapError;
  }

  const { data: inserted, error: insertError } = await client
    .from("candidate_cvs")
    .insert({
      candidate_id: candidateId,
      // storage_path is unique not null; a placeholder is written here and
      // immediately replaced below once the row's own id is known, since
      // the path is derived from candidateId + cvId.
      storage_path: `${candidateId}/pending-${randomToken()}`,
      original_filename: command.filename,
      mime_type: command.mimeType,
      size_bytes: command.sizeBytes,
      // Overwritten by the set_expires_at trigger from the row's own
      // uploaded_at -- the column has no default, so the insert type
      // requires a value here, but it is never actually used.
      expires_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError) {
    throw insertError;
  }

  const storagePath = buildStoragePath(candidateId, inserted.id, command.mimeType);

  const { error: updateError } = await client
    .from("candidate_cvs")
    .update({ storage_path: storagePath })
    .eq("id", inserted.id);

  if (updateError) {
    throw updateError;
  }

  const { data: signed, error: signError } = await client.storage.from(BUCKET).createSignedUploadUrl(storagePath);

  if (signError) {
    throw signError;
  }

  return {
    cvId: inserted.id,
    uploadUrl: signed.signedUrl,
    token: signed.token,
    path: storagePath,
  };
}

export async function confirmCvUpload(client: Client, cvId: number): Promise<CandidateCvDto> {
  const { data, error } = await client.rpc("confirm_candidate_cv", { target_cv_id: cvId });

  if (error) {
    throw error;
  }

  return toCvDto(data);
}

interface CvDownload {
  blob: Blob;
  filename: string;
  mimeType: string;
}

// Deliberately mirrors the delete-tombstone semantics rather than
// deriving `expired` purely on the client: a row already marked
// object_deleted_at (purged) is just as unreadable as one past
// expires_at, and both must raise the same PA005 code so the download
// route maps them identically.
export async function getCvForDownload(client: Client, candidateId: number): Promise<CvDownload | null> {
  const { data: row, error } = await client
    .from("candidate_cvs")
    .select("storage_path, original_filename, mime_type, expires_at, object_deleted_at")
    .eq("candidate_id", candidateId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!row) {
    return null;
  }

  if (row.object_deleted_at !== null || new Date(row.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error("This CV has expired and its file has been removed"), { code: "PA005" });
  }

  const { data: blob, error: downloadError } = await client.storage.from(BUCKET).download(row.storage_path);

  if (downloadError) {
    throw downloadError;
  }

  return { blob, filename: row.original_filename, mimeType: row.mime_type };
}

// Purge every eligible row: remove the Storage object first, then mark
// the row deleted -- reversing the order would lose the storage path
// while the bytes still exist, orphaning the file with no way to find
// it again. A missing object (already removed by a prior run) counts as
// success, making the endpoint idempotent.
export async function purgeCvObjects(client: Client): Promise<CvPurgeSummaryDto> {
  const { data: purgeable, error: listError } = await client.rpc("list_purgeable_candidate_cvs");

  if (listError) {
    throw listError;
  }

  const results: CvPurgeSummaryDto["results"] = [];

  for (const row of purgeable) {
    const { error: removeError } = await client.storage.from(BUCKET).remove([row.storage_path]);

    if (removeError) {
      results.push({ cvId: row.id, storagePath: row.storage_path, removed: false, error: removeError.message });
      continue;
    }

    const { error: markError } = await client.rpc("mark_candidate_cv_object_deleted", { target_cv_id: row.id });

    if (markError) {
      results.push({ cvId: row.id, storagePath: row.storage_path, removed: false, error: markError.message });
      continue;
    }

    results.push({ cvId: row.id, storagePath: row.storage_path, removed: true });
  }

  return {
    processed: results.length,
    removed: results.filter((result) => result.removed).length,
    failed: results.filter((result) => !result.removed).length,
    results,
  };
}

// Populates CandidateProfileDto.cv from the latest non-pending row for
// the candidate -- consumed by candidate-profile.ts so the profile
// renders the CV panel from one request.
export async function getLatestCvForProfile(client: Client, candidateId: number): Promise<CandidateCvDto | null> {
  const { data: row, error } = await client
    .from("candidate_cvs")
    .select(
      "id, candidate_id, storage_path, original_filename, mime_type, size_bytes, status, uploaded_at, expires_at, object_deleted_at",
    )
    .eq("candidate_id", candidateId)
    .neq("status", "pending")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle<CandidateCvRow>();

  if (error) {
    throw error;
  }

  if (!row) {
    return null;
  }

  return toCvDto(row);
}
