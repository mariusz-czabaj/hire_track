import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { handleSecurityGroupError } from "@/lib/api/security-group-errors";
import { grantGroupOperation, revokeGroupOperation } from "@/lib/services/security-groups";
import { operationSchema } from "@/types";
import { requireGroupManage } from "@/lib/api/group-manage-guard";

export const prerender = false;

const idParamSchema = z.coerce.number().int().positive();

const operationBodySchema = z.object({
  operation: operationSchema,
});

export const POST: APIRoute = async (context) => {
  const denied = requireGroupManage(context.locals);
  if (denied) return denied;

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

  const parsed = operationBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, "invalid_request", "Invalid operation value", { operation: "Invalid operation value" });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const operations = await grantGroupOperation(supabase, parsedId.data, parsed.data.operation);
    return jsonOk({ operations });
  } catch (error) {
    return handleSecurityGroupError(error);
  }
};

export const DELETE: APIRoute = async (context) => {
  const denied = requireGroupManage(context.locals);
  if (denied) return denied;

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

  const parsed = operationBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, "invalid_request", "Invalid operation value", { operation: "Invalid operation value" });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const operations = await revokeGroupOperation(supabase, parsedId.data, parsed.data.operation);
    return jsonOk({ operations });
  } catch (error) {
    return handleSecurityGroupError(error);
  }
};
