import { useCallback, useState } from "react";

export interface FieldOrderEntry<TKey extends string = string> {
  key: TKey;
  id: string;
}

/**
 * Focuses the first field (in declared order) that has a truthy error,
 * skipping entries whose id does not resolve to a focusable element (e.g. a
 * checkbox group with no single control) rather than giving up entirely.
 */
export function focusFirstInvalidField<TKey extends string>(
  errors: Partial<Record<TKey, string | undefined>>,
  order: FieldOrderEntry<TKey>[],
): void {
  if (typeof document === "undefined") return;
  for (const entry of order) {
    if (!errors[entry.key]) continue;
    const el = document.getElementById(entry.id);
    if (el && typeof el.focus === "function") {
      el.focus();
      return;
    }
  }
}

/**
 * Owns field-error state for a form or dialog and moves focus to the first
 * invalid field (in caller-declared order) whenever errors are set. Does not
 * assume a <form> element exists, since some consumers are dialog submit
 * handlers.
 */
export function useFormErrors<TKey extends string>() {
  const [errors, setErrorsState] = useState<Partial<Record<TKey, string | undefined>>>({});

  const setErrors = useCallback((next: Partial<Record<TKey, string | undefined>>, order: FieldOrderEntry<TKey>[]) => {
    setErrorsState(next);
    focusFirstInvalidField(next, order);
  }, []);

  const clearError = useCallback((key: TKey) => {
    setErrorsState((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }, []);

  return { errors, setErrors, clearError };
}
