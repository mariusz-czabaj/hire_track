import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { getRecruitmentStages, replaceRecruitmentStages, resetRecruitmentStages } from "@/lib/services/recruitments";

export const prerender = false;

const idParamSchema = z.coerce.number().int().positive();

const stageInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const replaceStagesSchema = z.object({
  stages: z.array(stageInputSchema).min(1),
});

// Distinct from the 23503->422 "nonexistent group" mapping in
// src/pages/api/recruitments/index.ts -- these errcodes are raised by the
// stage-write RPCs (see supabase/migrations/20260901162000_kanban_stage_rpcs.sql)
// and must stay unambiguous: P0002 (recruitment invisible to the caller),
// 42501 (visible but lacks recruitment.write), PA001 (candidates already
// exist, so stages are locked).
function handleStageRpcError(error: unknown): Response {
  const code = (error as { code?: string }).code;
  if (code === "P0002") {
    return jsonError(404, "not_found", "Recruitment not found");
  }
  if (code === "42501") {
    return jsonError(403, "forbidden", "You are not allowed to edit this recruitment's stages");
  }
  if (code === "PA001") {
    return jsonError(422, "stages_locked", "Stages can no longer be changed once the recruitment has candidates");
  }
  if (code === "22023") {
    const message = (error as { message?: string }).message ?? "Invalid stage data";
    return jsonError(422, "invalid_request", message, { stages: message });
  }
  console.error(error);
  return jsonError(500, "internal", "Failed to update stages");
}

export const GET: APIRoute = async (context) => {
  const parsedId = idParamSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return jsonError(422, "invalid_request", "Invalid recruitment id");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const result = await getRecruitmentStages(supabase, parsedId.data);
    if (!result) {
      return jsonError(404, "not_found", "Recruitment not found");
    }
    return jsonOk(result);
  } catch (error) {
    console.error(error);
    return jsonError(500, "internal", "Failed to load stages");
  }
};

export const PUT: APIRoute = async (context) => {
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

  const parsed = replaceStagesSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "root";
      fields[key] ??= issue.message;
    }
    return jsonError(422, "invalid_request", "Invalid stage data", fields);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const stages = await replaceRecruitmentStages(supabase, parsedId.data, {
      stageNames: parsed.data.stages.map((stage) => stage.name),
    });
    return jsonOk({ stagesSource: "custom", stages });
  } catch (error) {
    return handleStageRpcError(error);
  }
};

export const DELETE: APIRoute = async (context) => {
  const parsedId = idParamSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return jsonError(422, "invalid_request", "Invalid recruitment id");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const stages = await resetRecruitmentStages(supabase, parsedId.data);
    return jsonOk({ stagesSource: "default", stages });
  } catch (error) {
    return handleStageRpcError(error);
  }
};
