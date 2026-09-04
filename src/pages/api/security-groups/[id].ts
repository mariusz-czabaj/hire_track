import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { handleSecurityGroupError } from "@/lib/api/security-group-errors";
import { getSecurityGroupDetail, renameSecurityGroup } from "@/lib/services/security-groups";

export const prerender = false;

const idParamSchema = z.coerce.number().int().positive();

const renameGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const GET: APIRoute = async (context) => {
  const parsedId = idParamSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return jsonError(422, "invalid_request", "Invalid security group id");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const group = await getSecurityGroupDetail(supabase, parsedId.data);
    if (!group) {
      return jsonError(404, "not_found", "Security group not found");
    }
    return jsonOk(group);
  } catch (error) {
    return handleSecurityGroupError(error);
  }
};

export const PATCH: APIRoute = async (context) => {
  const parsedId = idParamSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return jsonError(422, "invalid_request", "Invalid security group id");
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError(422, "invalid_request", "Request body must be valid JSON");
  }

  const parsed = renameGroupSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "root";
      fields[key] ??= issue.message;
    }
    return jsonError(422, "invalid_request", "Invalid security group data", fields);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const group = await renameSecurityGroup(supabase, parsedId.data, parsed.data.name);
    return jsonOk(group);
  } catch (error) {
    return handleSecurityGroupError(error);
  }
};
