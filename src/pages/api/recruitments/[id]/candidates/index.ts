import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { handleCandidateRpcError } from "@/lib/api/candidate-errors";
import { addCandidateToRecruitment } from "@/lib/services/candidates";

export const prerender = false;

const idParamSchema = z.coerce.number().int().positive();

const addCandidateSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: z.email().trim().max(255),
  phone: z.string().trim().min(1).max(50).optional(),
});

export const POST: APIRoute = async (context) => {
  const parsedId = idParamSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return jsonError(422, "invalid_request", "Invalid recruitment id");
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError(422, "invalid_request", "Request body must be valid JSON");
  }

  const parsed = addCandidateSchema.safeParse(body);
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
    const candidate = await addCandidateToRecruitment(supabase, parsedId.data, parsed.data);
    return jsonOk(candidate, 201);
  } catch (error) {
    return handleCandidateRpcError(error);
  }
};
