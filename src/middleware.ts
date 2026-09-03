import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { jsonError } from "@/lib/api-response";

const PROTECTED_ROUTES = ["/dashboard", "/recruitments", "/candidates"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  const isApiRoute = context.url.pathname.startsWith("/api/") && !context.url.pathname.startsWith("/api/auth/");

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
