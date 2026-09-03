import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { handleCandidateProfileError } from "@/lib/api/candidate-errors";
import { listCandidates } from "@/lib/services/candidate-list";

export const prerender = false;

const queryParamSchema = z.string().trim().max(200).optional();

export const GET: APIRoute = async (context) => {
  const rawQuery = context.url.searchParams.get("q") ?? undefined;
  const parsedQuery = queryParamSchema.safeParse(rawQuery);

  if (!parsedQuery.success) {
    return jsonError(422, "invalid_request", "Invalid search query");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const list = await listCandidates(supabase, { query: parsedQuery.data });
    return jsonOk(list);
  } catch (error) {
    return handleCandidateProfileError(error);
  }
};
