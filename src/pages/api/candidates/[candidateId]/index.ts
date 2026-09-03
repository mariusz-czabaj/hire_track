import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { handleCandidateProfileError } from "@/lib/api/candidate-errors";
import { getCandidateProfile, updateCandidateProfile } from "@/lib/services/candidate-profile";

export const prerender = false;

const idParamSchema = z.coerce.number().int().positive();

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(50).optional(),
});

export const GET: APIRoute = async (context) => {
  const parsedId = idParamSchema.safeParse(context.params.candidateId);
  if (!parsedId.success) {
    return jsonError(422, "invalid_request", "Invalid candidate id");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const profile = await getCandidateProfile(supabase, parsedId.data);
    if (!profile) {
      return jsonError(404, "not_found", "Candidate not found");
    }
    return jsonOk(profile);
  } catch (error) {
    return handleCandidateProfileError(error);
  }
};

export const PATCH: APIRoute = async (context) => {
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

  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "root";
      fields[key] ??= issue.message;
    }
    return jsonError(422, "invalid_request", "Invalid candidate data", fields);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const profile = await updateCandidateProfile(supabase, parsedId.data, parsed.data);
    if (!profile) {
      return jsonError(404, "not_found", "Candidate not found");
    }
    return jsonOk(profile);
  } catch (error) {
    return handleCandidateProfileError(error);
  }
};
