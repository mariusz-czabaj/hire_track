import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { handleSecurityGroupError } from "@/lib/api/security-group-errors";
import { searchUsers } from "@/lib/services/security-groups";
import { requireGroupManage } from "@/lib/api/group-manage-guard";

export const prerender = false;

const MIN_QUERY_LENGTH = 2;

// A too-short term is not an error -- it mirrors the RPC's own inert-on-short
// -term behaviour and returns an empty list. The cap is the only rejection,
// and it exists so an oversized term never reaches the database.
const MAX_QUERY_LENGTH = 100;

export const GET: APIRoute = async (context) => {
  const denied = requireGroupManage(context.locals);
  if (denied) return denied;

  const rawQuery = context.url.searchParams.get("q")?.trim() ?? "";

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  if (rawQuery.length < MIN_QUERY_LENGTH) {
    return jsonOk([]);
  }

  const parsed = z.string().max(MAX_QUERY_LENGTH).safeParse(rawQuery);
  if (!parsed.success) {
    return jsonError(422, "invalid_request", `Search term must be at most ${MAX_QUERY_LENGTH} characters`);
  }

  try {
    const users = await searchUsers(supabase, parsed.data);
    return jsonOk(users);
  } catch (error) {
    return handleSecurityGroupError(error);
  }
};
