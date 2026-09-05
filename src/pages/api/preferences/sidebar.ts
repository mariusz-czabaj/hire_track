import type { APIRoute } from "astro";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api-response";
import { SIDEBAR_COLLAPSED_COOKIE_NAME, sidebarCollapsedSchema } from "@/lib/sidebar";

export const prerender = false;

const setSidebarCollapsedSchema = z.object({
  collapsed: sidebarCollapsedSchema,
});

export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError(422, "invalid_request", "Request body must be valid JSON");
  }

  const parsed = setSidebarCollapsedSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, "invalid_request", "Invalid sidebar collapse preference");
  }

  context.cookies.set(SIDEBAR_COLLAPSED_COOKIE_NAME, parsed.data.collapsed, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
  });

  return jsonOk({ collapsed: parsed.data.collapsed });
};
