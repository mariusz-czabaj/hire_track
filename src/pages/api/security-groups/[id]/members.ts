import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { handleSecurityGroupError } from "@/lib/api/security-group-errors";
import { addGroupMember, removeGroupMember } from "@/lib/services/security-groups";

export const prerender = false;

const idParamSchema = z.coerce.number().int().positive();

const memberBodySchema = z.object({
  userId: z.guid(),
});

export const POST: APIRoute = async (context) => {
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

  const parsed = memberBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, "invalid_request", "Invalid user id", { userId: "Invalid user id" });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const members = await addGroupMember(supabase, parsedId.data, parsed.data.userId);
    return jsonOk({ members });
  } catch (error) {
    return handleSecurityGroupError(error);
  }
};

export const DELETE: APIRoute = async (context) => {
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

  const parsed = memberBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, "invalid_request", "Invalid user id", { userId: "Invalid user id" });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const members = await removeGroupMember(supabase, parsedId.data, parsed.data.userId);
    return jsonOk({ members });
  } catch (error) {
    return handleSecurityGroupError(error);
  }
};
