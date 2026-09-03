import { jsonError } from "@/lib/api-response";

// Shared across every candidate write route (POST candidates, PATCH
// candidate, PUT notes) -- modelled on handleStageRpcError
// (src/pages/api/recruitments/[id]/stages.ts), but adds the two
// candidate-specific codes raised by
// supabase/migrations/20260901210500_candidate_write_rpcs.sql: PA003
// (candidate_name_mismatch) and PA004 (note_required).
export function handleCandidateRpcError(error: unknown): Response {
  const code = (error as { code?: string }).code;
  if (code === "P0002") {
    return jsonError(404, "not_found", "Candidate not found");
  }
  if (code === "42501") {
    return jsonError(403, "forbidden", "You are not allowed to perform this action");
  }
  if (code === "PA003") {
    const message =
      (error as { message?: string }).message ?? "A candidate with this email already exists under a different name";
    return jsonError(422, "candidate_name_mismatch", message, { fullName: message });
  }
  if (code === "PA004") {
    return jsonError(422, "note_required", "A note for the stage being left is required before moving", {
      note: "A note for the stage being left is required before moving",
    });
  }
  if (code === "22023") {
    const message = (error as { message?: string }).message ?? "Invalid candidate data";
    return jsonError(422, "invalid_request", message);
  }
  console.error(error);
  return jsonError(500, "internal", "Failed to process the candidate request");
}

// Shared by the candidate-profile routes, which perform plain RLS-covered
// table operations rather than RPCs, so only the RLS-denial and
// data-validation codes Postgres can raise directly apply here. Phase 3
// extends this pattern with handleCandidateCvError for the CV lifecycle's
// own errcodes (PA005, 23505).
export function handleCandidateProfileError(error: unknown): Response {
  const code = (error as { code?: string }).code;
  if (code === "42501") {
    return jsonError(403, "forbidden", "You are not allowed to perform this action");
  }
  if (code === "22023") {
    const message = (error as { message?: string }).message ?? "Invalid candidate data";
    return jsonError(422, "invalid_request", message);
  }
  console.error(error);
  return jsonError(500, "internal", "Failed to process the candidate request");
}
