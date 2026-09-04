import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { handleSecurityGroupError } from "@/lib/api/security-group-errors";
import { createSecurityGroup, listSecurityGroups } from "@/lib/services/security-groups";
import { requireGroupManage } from "@/lib/api/group-manage-guard";

export const prerender = false;

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const groups = await listSecurityGroups(supabase);
    return jsonOk(groups);
  } catch (error) {
    console.error(error);
    return jsonError(500, "internal", "Failed to load security groups");
  }
};

export const POST: APIRoute = async (context) => {
  const denied = requireGroupManage(context.locals);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError(422, "invalid_request", "Request body must be valid JSON");
  }

  const parsed = createGroupSchema.safeParse(body);
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
    const group = await createSecurityGroup(supabase, parsed.data.name);
    return jsonOk(group, 201);
  } catch (error) {
    return handleSecurityGroupError(error);
  }
};
