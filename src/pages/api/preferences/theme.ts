import type { APIRoute } from "astro";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api-response";
import { THEME_COOKIE_NAME, themeSchema } from "@/lib/theme";

export const prerender = false;

const setThemeSchema = z.object({
  theme: themeSchema,
});

export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError(422, "invalid_request", "Request body must be valid JSON");
  }

  const parsed = setThemeSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, "invalid_request", "Invalid theme preference");
  }

  context.cookies.set(THEME_COOKIE_NAME, parsed.data.theme, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
  });

  return jsonOk({ theme: parsed.data.theme });
};
