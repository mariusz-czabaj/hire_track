import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { handleSecurityGroupError } from "@/lib/api/security-group-errors";
import { searchUsers } from "@/lib/services/security-groups";

export const prerender = false;

const MIN_QUERY_LENGTH = 2;

export const GET: APIRoute = async (context) => {
  const rawQuery = context.url.searchParams.get("q")?.trim() ?? "";

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  if (rawQuery.length < MIN_QUERY_LENGTH) {
    return jsonOk([]);
  }

  try {
    const users = await searchUsers(supabase, rawQuery);
    return jsonOk(users);
  } catch (error) {
    return handleSecurityGroupError(error);
  }
};
