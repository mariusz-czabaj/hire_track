import { jsonError } from "@/lib/api-response";

// Shared across every route in the admin group-management family (group
// create/rename, operation grant/revoke, member add/remove, user search).
// Every errcode the layer can raise gets an explicit branch per house
// convention (see candidate-errors.ts) -- unmapped codes fell through to
// 500s three times in prior slices.
export function handleSecurityGroupError(error: unknown): Response {
  const code = (error as { code?: string }).code;
  if (code === "42501") {
    return jsonError(403, "forbidden", "You are not allowed to perform this action");
  }
  if (code === "23505") {
    const message = (error as { message?: string }).message ?? "This value is already in use";
    return jsonError(422, "invalid_request", message);
  }
  if (code === "23503") {
    return jsonError(422, "invalid_request", "The referenced user does not exist");
  }
  if (code === "22023") {
    const message = (error as { message?: string }).message ?? "Invalid data";
    return jsonError(422, "invalid_request", message);
  }
  if (code === "PA006") {
    const message = (error as { message?: string }).message ?? "At least one administrator must retain group.manage";
    return jsonError(422, "last_admin_required", message);
  }
  console.error(error);
  return jsonError(500, "internal", "Failed to process the security group request");
}
