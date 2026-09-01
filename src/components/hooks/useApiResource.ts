import { useEffect, useRef, useState } from "react";
import type { ApiErrorBody } from "@/types";

export type ApiResourceState<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "not-found" }
  | { status: "error"; message: string };

const DEFAULT_ERROR_MESSAGE = "Something went wrong. Please try again.";

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return body.error.message || DEFAULT_ERROR_MESSAGE;
  } catch {
    return DEFAULT_ERROR_MESSAGE;
  }
}

/**
 * Fetches a JSON endpoint and exposes loading / success / not-found / error
 * state. A 401 redirects to sign-in rather than surfacing as an error state,
 * since the session may have expired between the server render and this
 * fetch. Re-fetches whenever `url` changes.
 */
export function useApiResource<T>(url: string): ApiResourceState<T> {
  const [result, setResult] = useState<{ url: string; state: ApiResourceState<T> }>({
    url,
    state: { status: "loading" },
  });
  const ignoreRef = useRef(false);

  useEffect(() => {
    ignoreRef.current = false;

    void (async () => {
      try {
        const response = await fetch(url);

        if (response.status === 401) {
          window.location.href = "/auth/signin";
          return;
        }

        if (response.status === 404) {
          if (!ignoreRef.current) setResult({ url, state: { status: "not-found" } });
          return;
        }

        if (!response.ok) {
          const message = await readErrorMessage(response);
          if (!ignoreRef.current) setResult({ url, state: { status: "error", message } });
          return;
        }

        const data = (await response.json()) as T;
        if (!ignoreRef.current) setResult({ url, state: { status: "success", data } });
      } catch {
        if (!ignoreRef.current) setResult({ url, state: { status: "error", message: DEFAULT_ERROR_MESSAGE } });
      }
    })();

    return () => {
      ignoreRef.current = true;
    };
  }, [url]);

  return result.url === url ? result.state : { status: "loading" };
}
