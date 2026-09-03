import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { handleCandidateCvError } from "@/lib/api/candidate-errors";
import { confirmCvUpload } from "@/lib/services/candidate-cv";

export const prerender = false;

const idParamSchema = z.coerce.number().int().positive();

const confirmSchema = z.object({
  cvId: z.number().int().positive(),
});

export const POST: APIRoute = async (context) => {
  const parsedId = idParamSchema.safeParse(context.params.candidateId);
  if (!parsedId.success) {
    return jsonError(422, "invalid_request", "Invalid candidate id");
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError(422, "invalid_request", "Request body must be valid JSON");
  }

  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, "invalid_request", "Invalid confirm request");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const cv = await confirmCvUpload(supabase, parsed.data.cvId);
    return jsonOk(cv);
  } catch (error) {
    return handleCandidateCvError(error);
  }
};
