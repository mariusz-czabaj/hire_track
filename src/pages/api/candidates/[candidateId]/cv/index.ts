import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError } from "@/lib/api-response";
import { handleCandidateCvError } from "@/lib/api/candidate-errors";
import { getCvForDownload } from "@/lib/services/candidate-cv";

export const prerender = false;

const idParamSchema = z.coerce.number().int().positive();

export const GET: APIRoute = async (context) => {
  const parsedId = idParamSchema.safeParse(context.params.candidateId);
  if (!parsedId.success) {
    return jsonError(422, "invalid_request", "Invalid candidate id");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "supabase_unconfigured", "Supabase is not configured");
  }

  try {
    const download = await getCvForDownload(supabase, parsedId.data);
    if (!download) {
      return jsonError(404, "not_found", "No CV found for this candidate");
    }

    return new Response(download.blob, {
      status: 200,
      headers: {
        "Content-Type": download.mimeType,
        "Content-Disposition": `attachment; filename="${download.filename.replace(/"/g, "")}"`,
      },
    });
  } catch (error) {
    return handleCandidateCvError(error);
  }
};
