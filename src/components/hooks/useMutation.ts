import { useState } from "react";
import type { ApiErrorBody } from "@/types";

export type MutationStatus = "idle" | "loading" | "success" | "error";

const DEFAULT_ERROR_MESSAGE = "Something went wrong. Please try again.";

/**
 * Fetch-based imperative mutation hook (POST/PATCH), sibling to the
 * GET-only useApiResource. `mutate` resolves with the parsed response body
 * on success, or throws after populating `error`/`fieldErrors` state so a
 * caller can either read the hook's state or catch the rejection.
 */
export interface UseMutationResult<TBody, TResponse> {
  mutate: (body: TBody) => Promise<TResponse>;
  status: MutationStatus;
  error: string | null;
  fieldErrors: Record<string, string> | undefined;
}

export function useMutation<TBody, TResponse>(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
): UseMutationResult<TBody, TResponse> {
  const [status, setStatus] = useState<MutationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>(undefined);

  async function mutate(body: TBody): Promise<TResponse> {
    setStatus("loading");
    setError(null);
    setFieldErrors(undefined);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      setStatus("error");
      setError(DEFAULT_ERROR_MESSAGE);
      throw new Error(DEFAULT_ERROR_MESSAGE);
    }

    if (response.status === 401) {
      window.location.assign("/auth/signin");
      throw new Error("Authentication required");
    }

    if (!response.ok) {
      let message = DEFAULT_ERROR_MESSAGE;
      let fields: Record<string, string> | undefined;
      try {
        const body = (await response.json()) as ApiErrorBody;
        message = body.error.message || DEFAULT_ERROR_MESSAGE;
        fields = body.error.fields;
      } catch {
        // fall through to defaults
      }
      setStatus("error");
      setError(message);
      setFieldErrors(fields);
      throw new Error(message);
    }

    const data = (await response.json()) as TResponse;
    setStatus("success");
    return data;
  }

  return { mutate, status, error, fieldErrors };
}
