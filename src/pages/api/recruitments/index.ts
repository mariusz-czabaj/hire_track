import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { listRecruitments } from "@/lib/services/recruitments";
import { recruitmentStatusSchema } from "@/types";

export const prerender = false;

const statusParamSchema = z.union([recruitmentStatusSchema, z.literal("all")]).optional();

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
