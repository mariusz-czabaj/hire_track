import { z } from "zod";

export const SIDEBAR_COLLAPSED_COOKIE_NAME = "sidebar-collapsed";

export const sidebarCollapsedSchema = z.enum(["true", "false"]);

export type SidebarCollapsedValue = z.infer<typeof sidebarCollapsedSchema>;

/** Resolves a raw cookie value to whether the sidebar is collapsed. Unrecognised or absent values default to expanded. */
export function resolveSidebarCollapsed(cookieValue: string | undefined): boolean {
  const parsed = sidebarCollapsedSchema.safeParse(cookieValue);
  return parsed.success ? parsed.data === "true" : false;
}
