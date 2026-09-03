import { useEffect, useState } from "react";

/**
 * Returns `value` after `delayMs` has elapsed with no further change.
 * Clears its timer on unmount or when `value`/`delayMs` change again.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}
