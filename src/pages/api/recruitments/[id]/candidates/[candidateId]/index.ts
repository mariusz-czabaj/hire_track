import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { handleCandidateRpcError } from "@/lib/api/candidate-errors";
import { getCandidateDetail, moveCandidateStage } from "@/lib/services/candidates";

export const prerender = false;

const idParamSchema = z.coerce.number().int().positive();

const moveCandidateSchema = z.object({
  toStageId: z.number().int().positive(),
  note: z.string().trim().min(1).optional(),
});

export const GET: APIRoute = async (context) => {
  const parsedId = idParamSchema.safeParse(context.params.id);
  const parsedCandidateId = idParamSchema.safeParse(context.params.candidateId);
  if (!parsedId.success || !parsedCandidateId.success) {
    return jsonError(422, "invalid_request", "Invalid recruitment or candidate id");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const detail = await getCandidateDetail(supabase, parsedId.data, parsedCandidateId.data);
    if (!detail) {
      return jsonError(404, "not_found", "Candidate not found");
    }
    return jsonOk(detail);
  } catch (error) {
    console.error(error);
    return jsonError(500, "internal", "Failed to load candidate detail");
  }
};

export const PATCH: APIRoute = async (context) => {
  const parsedId = idParamSchema.safeParse(context.params.id);
  const parsedCandidateId = idParamSchema.safeParse(context.params.candidateId);
  if (!parsedId.success || !parsedCandidateId.success) {
    return jsonError(422, "invalid_request", "Invalid recruitment or candidate id");
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError(422, "invalid_request", "Request body must be valid JSON");
  }

  const parsed = moveCandidateSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "root";
      fields[key] ??= issue.message;
    }
    return jsonError(422, "invalid_request", "Invalid move data", fields);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const result = await moveCandidateStage(supabase, parsedId.data, parsedCandidateId.data, parsed.data);
    if (!result) {
      return jsonError(404, "not_found", "Candidate not found");
    }
    return jsonOk(result);
  } catch (error) {
    return handleCandidateRpcError(error);
  }
};
