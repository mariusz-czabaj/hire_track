import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { getKanbanBoard } from "@/lib/services/recruitments";

export const prerender = false;

const idParamSchema = z.coerce.number().int().positive();

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
    const board = await getKanbanBoard(supabase, parsedId.data);
    if (!board) {
      return jsonError(404, "not_found", "Recruitment not found");
    }
    return jsonOk(board);
  } catch {
    return jsonError(500, "internal", "Failed to load kanban board");
  }
};
