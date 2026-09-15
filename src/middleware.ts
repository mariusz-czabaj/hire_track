import { defineMiddleware } from "astro:middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { jsonError } from "@/lib/api-response";
import type { Database } from "@/db/database.types";
import type { Operation } from "@/types";
import { resolveTheme, THEME_COOKIE_NAME } from "@/lib/theme";
import { resolveSidebarCollapsed, SIDEBAR_COLLAPSED_COOKIE_NAME } from "@/lib/sidebar";

const PROTECTED_ROUTES = ["/recruitments", "/candidates", "/admin"];

// Routes under /api/ that must stay reachable without authentication. Kept separate from
// isAuthRoute below, which also skips resolveCallerOperations - widening it would silently
// change permission-resolution semantics for routes that have nothing to do with auth.
const PUBLIC_API_ROUTES = ["/api/preferences/theme", "/api/preferences/sidebar"];

// group_operations' RLS is admin-only for SELECT (see rls_policies.sql), so a
// non-admin caller's own client can never read it directly -- this RPC is
// SECURITY DEFINER and returns only the calling user's own operations.
async function resolveCallerOperations(supabase: SupabaseClient<Database>): Promise<Operation[]> {
  const { data: operations, error } = await supabase.rpc("get_caller_operations");

  if (error) {
    throw error;
  }

  return [...new Set(operations)];
}

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.theme = resolveTheme(context.cookies.get(THEME_COOKIE_NAME)?.value);
  context.locals.sidebarCollapsed = resolveSidebarCollapsed(context.cookies.get(SIDEBAR_COLLAPSED_COOKIE_NAME)?.value);

  const supabase = createClient(context.request.headers, context.cookies);
  const isAuthRoute = context.url.pathname.startsWith("/api/auth/");
  const isPublicApiRoute = PUBLIC_API_ROUTES.some((route) => context.url.pathname.startsWith(route));

  if (supabase) {
    // A stale/invalid refresh-token cookie (e.g. after a manual cookie wipe or
    // an expired local session) makes the underlying refresh call throw rather
    // than resolve with an error field. Treat that the same as "no session"
    // instead of taking the whole app down.
    let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
    try {
      ({
        data: { user },
      } = await supabase.auth.getUser());
    } catch (error) {
      console.error("Failed to resolve the current user", error);
    }
    context.locals.user = user ?? null;

    // A failure here must not take the whole app down: this signal only
    // drives rendering (nav entries, not-authorized states), and every route
    // and RPC keeps its own server-side gate. Falling back to an empty set
    // fails closed for permissions while leaving the page renderable.
    let operations: Operation[] = [];
    if (user && !isAuthRoute) {
      try {
        operations = await resolveCallerOperations(supabase);
      } catch (error) {
        console.error("Failed to resolve caller operations", error);
      }
    }
    context.locals.operations = operations;
  } else {
    context.locals.user = null;
    context.locals.operations = [];
  }

  const isApiRoute = context.url.pathname.startsWith("/api/") && !isAuthRoute && !isPublicApiRoute;

  if (isApiRoute) {
    if (!context.locals.user) {
      return jsonError(401, "unauthenticated", "Authentication required");
    }
    return next();
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
