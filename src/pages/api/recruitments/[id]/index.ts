import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { updateRecruitmentStatus } from "@/lib/services/recruitments";
import { recruitmentStatusSchema } from "@/types";

export const prerender = false;

const idParamSchema = z.coerce.number().int().positive();

const updateStatusSchema = z.object({
  status: recruitmentStatusSchema,
});

export const PATCH: APIRoute = async (context) => {
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

  const parsedBody = updateStatusSchema.safeParse(body);
  if (!parsedBody.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsedBody.error.issues) {
      const key = issue.path.join(".") || "root";
      fields[key] ??= issue.message;
    }
    return jsonError(422, "invalid_request", "Invalid status value", fields);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const updated = await updateRecruitmentStatus(supabase, parsedId.data, parsedBody.data.status);
    if (!updated) {
      return jsonError(404, "not_found", "Recruitment not found");
    }
    return jsonOk(updated);
  } catch (error) {
    console.error(error);
    return jsonError(500, "internal", "Failed to update recruitment status");
  }
};
