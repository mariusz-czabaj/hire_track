import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { createRecruitment, listRecruitments } from "@/lib/services/recruitments";
import { employmentTypeSchema, recruitmentStatusSchema } from "@/types";

export const prerender = false;

const statusParamSchema = z.union([recruitmentStatusSchema, z.literal("all")]).optional();

const createRecruitmentSchema = z.object({
  title: z.string().min(1),
  department: z.string().min(1),
  location: z.string().min(1),
  employmentType: employmentTypeSchema,
  openedAt: z.string().min(1),
  groupIds: z.array(z.number().int().positive()).min(1),
});

export const GET: APIRoute = async (context) => {
  const rawStatus = context.url.searchParams.get("status") ?? undefined;
  const parsedStatus = statusParamSchema.safeParse(rawStatus);

  if (!parsedStatus.success) {
    return jsonError(422, "invalid_request", "Invalid status filter");
  }

  const status = parsedStatus.data === "all" ? undefined : parsedStatus.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const recruitments = await listRecruitments(supabase, { status });
    return jsonOk(recruitments);
  } catch (error) {
    console.error(error);
    return jsonError(500, "internal", "Failed to load recruitments");
  }
};

export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError(422, "invalid_request", "Request body must be valid JSON");
  }

  const parsed = createRecruitmentSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "root";
      fields[key] ??= issue.message;
    }
    return jsonError(422, "invalid_request", "Invalid recruitment data", fields);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const recruitment = await createRecruitment(supabase, parsed.data);
    return jsonOk(recruitment, 201);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") {
      return jsonError(403, "forbidden", "You are not allowed to create a recruitment");
    }
    if (code === "22023") {
      return jsonError(422, "invalid_request", "At least one security group is required", {
        groupIds: "At least one security group is required",
      });
    }
    if (code === "23503") {
      return jsonError(422, "invalid_request", "One or more security groups do not exist", {
        groupIds: "One or more security groups do not exist",
      });
    }
    console.error(error);
    return jsonError(500, "internal", "Failed to create recruitment");
  }
};
