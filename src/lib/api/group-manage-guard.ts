import { jsonError } from "@/lib/api-response";

/**
 * Explicit `group.manage` gate for the admin API family.
 *
 * The database is still the authority -- RLS and the SECURITY DEFINER guards
 * deny non-admins regardless of what happens here. This exists because that
 * denial was previously *incidental*: `security_groups_select` returns true
 * for every authenticated user, so a non-admin only tripped over 42501 once a
 * later read reached a gated function. Reordering the reads in the service
 * layer would have silently turned a 403 into a 200 with an empty payload.
 *
 * Returns a 403 Response when the caller lacks the operation, or null when the
 * handler should proceed. Call it as the first statement of each handler.
 *
 * Note: `GET /api/security-groups` deliberately does NOT use this -- every
 * authenticated user needs the group list to assign one at recruitment
 * creation time (FR-001a).
 */
export function requireGroupManage(locals: App.Locals): Response | null {
  if (!locals.operations.includes("group.manage")) {
    return jsonError(403, "forbidden", "This action requires the group.manage operation");
  }
  return null;
}
