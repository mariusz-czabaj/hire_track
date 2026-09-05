import { z } from "zod";

export const THEME_COOKIE_NAME = "theme";

export const themeSchema = z.enum(["light", "dark"]);

export type Theme = z.infer<typeof themeSchema>;

/** Resolves a raw cookie value to a theme. `null` means "follow the system preference". */
export function resolveTheme(cookieValue: string | undefined): Theme | null {
  const parsed = themeSchema.safeParse(cookieValue);
  return parsed.success ? parsed.data : null;
}
