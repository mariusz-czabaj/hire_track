import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api-response";
import { listSecurityGroups } from "@/lib/services/security-groups";

export const prerender = false;

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
