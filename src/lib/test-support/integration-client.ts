/**
 * HTTP integration-test harness: signs in as a seeded role via the real
 * /api/auth/signin endpoint (capturing its Set-Cookie response headers,
 * exactly as a browser would) and returns a fetch-compatible caller that
 * replays that session cookie on every subsequent request.
 *
 * Manual prerequisite: a local Supabase stack (`npx supabase start`) and a
 * running Astro server at TEST_BASE_URL (defaults to http://localhost:4321,
 * e.g. via `npm run dev` in a separate terminal) must both be up before
 * running tests that use this harness. Neither is started automatically —
 * this is a new requirement `npm run test` didn't previously have, scoped
 * to the specific test files that import this module.
 */

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:4321";
const PASSWORD = "password123";

const SEEDED_CREDENTIALS = {
  hr: "hr.test@example.com",
  hiringManager: "hiring-manager.test@example.com",
  admin: "admin.test@example.com",
  // Authorization test fixtures (testing-authorization-tenancy-contract,
  // Phase 1) -- see supabase/seed.sql for what each principal proves.
  tenantPeer: "tenant-peer.test@example.com",
  noGroup: "no-group.test@example.com",
  multiGroup: "multi-group.test@example.com",
} as const;

export type SeededRole = keyof typeof SEEDED_CREDENTIALS;

export interface IntegrationClient {
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

/**
 * Signs in as the given seeded role and returns a caller that attaches the
 * resulting session cookie to every request against TEST_BASE_URL.
 */
export async function signInIntegrationClient(role: SeededRole): Promise<IntegrationClient> {
  const form = new URLSearchParams({
    email: SEEDED_CREDENTIALS[role],
    password: PASSWORD,
  });

  const signInResponse = await fetch(`${BASE_URL}/api/auth/signin`, {
    method: "POST",
    body: form,
    redirect: "manual",
    // Astro's built-in CSRF protection rejects same-origin form POSTs that
    // don't carry an Origin header matching the request host -- a plain
    // curl/fetch call has none by default, unlike a real browser form
    // submission.
    headers: { Origin: BASE_URL },
  });

  const cookies = signInResponse.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

  if (!cookies) {
    throw new Error(
      `integration-client: sign-in as "${role}" set no session cookie (status ${signInResponse.status}). ` +
        `Is the local Supabase stack running and TEST_BASE_URL (${BASE_URL}) reachable?`,
    );
  }

  return {
    fetch(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      headers.set("Cookie", cookies);
      headers.set("Content-Type", "application/json");
      return fetch(`${BASE_URL}${path}`, {
        ...init,
        headers,
      });
    },
  };
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
export const SUPABASE_ANON_KEY = process.env.SUPABASE_KEY ?? "";

/**
 * Signs in as the given seeded role directly against GoTrue (bypassing the
 * Astro app entirely) and returns the raw access token. For the rare
 * assertion that must call PostgREST directly rather than through an Astro
 * route -- e.g. `recruitment_security_groups` DELETE, which the app never
 * exercises because no route detaches a group (test-plan.md §2 risk #5,
 * Phase 4's accepted-weakness characterization).
 */
export async function getAccessTokenForRole(role: SeededRole): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: SEEDED_CREDENTIALS[role], password: PASSWORD }),
  });

  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error(
      `getAccessTokenForRole: sign-in as "${role}" against GoTrue returned no access_token (status ${response.status}). ` +
        `Is the local Supabase stack running and SUPABASE_URL (${SUPABASE_URL}) reachable?`,
    );
  }
  return body.access_token;
}

/** Builds a PostgREST URL for direct table access, bypassing the Astro app. */
export function supabaseRestUrl(path: string): string {
  return `${SUPABASE_URL}/rest/v1${path}`;
}
