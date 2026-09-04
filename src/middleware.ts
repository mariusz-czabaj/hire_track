import { defineMiddleware } from "astro:middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { jsonError } from "@/lib/api-response";
import type { Database } from "@/db/database.types";
import type { Operation } from "@/types";

const PROTECTED_ROUTES = ["/dashboard", "/recruitments", "/candidates", "/admin"];

async function resolveCallerOperations(supabase: SupabaseClient<Database>, userId: string): Promise<Operation[]> {
  const { data: memberships, error: membershipsError } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("user_id", userId);

  if (membershipsError) {
    throw membershipsError;
  }

  const groupIds = [...new Set(memberships.map((row) => row.group_id))];
  if (groupIds.length === 0) {
    return [];
  }

  const { data: operations, error: operationsError } = await supabase
    .from("group_operations")
    .select("operation")
    .in("group_id", groupIds);

  if (operationsError) {
    throw operationsError;
  }

  return [...new Set(operations.map((row) => row.operation))];
}

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);
  const isAuthRoute = context.url.pathname.startsWith("/api/auth/");

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;

    // A failure here must not take the whole app down: this signal only
    // drives rendering (nav entries, not-authorized states), and every route
    // and RPC keeps its own server-side gate. Falling back to an empty set
    // fails closed for permissions while leaving the page renderable.
    let operations: Operation[] = [];
    if (user && !isAuthRoute) {
      try {
        operations = await resolveCallerOperations(supabase, user.id);
      } catch (error) {
        console.error("Failed to resolve caller operations", error);
      }
    }
    context.locals.operations = operations;
  } else {
    context.locals.user = null;
    context.locals.operations = [];
  }

  const isApiRoute = context.url.pathname.startsWith("/api/") && !isAuthRoute;

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
