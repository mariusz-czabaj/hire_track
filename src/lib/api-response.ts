import type { ApiErrorBody } from "@/types";

export function jsonOk(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonError(status: number, code: string, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
