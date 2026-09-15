import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { updateRecruitmentDetails, updateRecruitmentStatus } from "@/lib/services/recruitments";
import { recruitmentStatusSchema } from "@/types";
import { editRecruitmentDetailsSchema } from "@/lib/validation/recruitment";

export const prerender = false;

const idParamSchema = z.coerce.number().int().positive();

const updateStatusSchema = z.object({
  status: recruitmentStatusSchema,
});

function hasDetailFields(body: unknown): boolean {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  return ["title", "department", "location", "employmentType", "openedAt"].some((key) => key in body);
}

function hasStatusField(body: unknown): boolean {
  return typeof body === "object" && body !== null && "status" in body;
}

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

  if (hasStatusField(body) && hasDetailFields(body)) {
    return jsonError(422, "invalid_request", "Status and details cannot be updated in the same request");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  if (hasStatusField(body)) {
    const parsedBody = updateStatusSchema.safeParse(body);
    if (!parsedBody.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsedBody.error.issues) {
        const key = issue.path.join(".") || "root";
        fields[key] ??= issue.message;
      }
      return jsonError(422, "invalid_request", "Invalid status value", fields);
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
  }

  const parsedDetails = editRecruitmentDetailsSchema.safeParse(body);
  if (!parsedDetails.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsedDetails.error.issues) {
      const key = issue.path.join(".") || "root";
      fields[key] ??= issue.message;
    }
    return jsonError(422, "invalid_request", "Invalid recruitment details", fields);
  }

  try {
    const updated = await updateRecruitmentDetails(supabase, parsedId.data, parsedDetails.data);
    return jsonOk(updated);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") {
      return jsonError(403, "forbidden", "You are not allowed to edit this recruitment");
    }
    if (code === "P0002") {
      return jsonError(404, "not_found", "Recruitment not found");
    }
    console.error(error);
    return jsonError(500, "internal", "Failed to update recruitment details");
  }
};
