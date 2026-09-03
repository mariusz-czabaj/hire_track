import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { handleCandidateCvError } from "@/lib/api/candidate-errors";
import { createCvUploadIntent } from "@/lib/services/candidate-cv";

export const prerender = false;

const idParamSchema = z.coerce.number().int().positive();

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

// A friendly pre-check only -- the bucket's own file_size_limit and
// allowed_mime_types (supabase/config.toml) remain the real boundary,
// since the app never sees the bytes on a browser-direct upload.
const uploadIntentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_SIZE_BYTES),
});

export const POST: APIRoute = async (context) => {
  const parsedId = idParamSchema.safeParse(context.params.candidateId);
  if (!parsedId.success) {
    return jsonError(422, "invalid_request", "Invalid candidate id");
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError(422, "invalid_request", "Request body must be valid JSON");
  }

  const parsed = uploadIntentSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "root";
      fields[key] ??= issue.message;
    }
    return jsonError(422, "invalid_request", "Invalid upload request", fields);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const intent = await createCvUploadIntent(supabase, parsedId.data, parsed.data);
    return jsonOk(intent);
  } catch (error) {
    return handleCandidateCvError(error);
  }
};
