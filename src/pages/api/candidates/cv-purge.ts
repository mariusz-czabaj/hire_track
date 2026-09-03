import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { handleCandidateCvError } from "@/lib/api/candidate-errors";
import { purgeCvObjects } from "@/lib/services/candidate-cv";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const summary = await purgeCvObjects(supabase);
    return jsonOk(summary);
  } catch (error) {
    return handleCandidateCvError(error);
  }
};
