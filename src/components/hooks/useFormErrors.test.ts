import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useFormErrors } from "@/components/hooks/useFormErrors";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function mountField(id: string): HTMLInputElement {
  const input = document.createElement("input");
  input.id = id;
  document.body.appendChild(input);
  return input;
}

describe("useFormErrors", () => {
  it("sets errors from a failed validation", () => {
    mountField("email");
    mountField("password");
    const { result } = renderHook(() => useFormErrors<"email" | "password">());

    act(() => {
      result.current.setErrors({ email: "Email is required", password: "Password is required" }, [
        { key: "email", id: "email" },
        { key: "password", id: "password" },
      ]);
    });

    expect(result.current.errors).toEqual({ email: "Email is required", password: "Password is required" });
  });

  it("focuses the first invalid field in declared order, not the last", () => {
    const email = mountField("email");
    const password = mountField("password");
    const focusEmail = vi.spyOn(email, "focus");
    const focusPassword = vi.spyOn(password, "focus");
    const { result } = renderHook(() => useFormErrors<"email" | "password">());

    act(() => {
      result.current.setErrors({ email: "Email is required", password: "Password is required" }, [
        { key: "email", id: "email" },
        { key: "password", id: "password" },
      ]);
    });

    expect(focusEmail).toHaveBeenCalledTimes(1);
    expect(focusPassword).not.toHaveBeenCalled();
  });

  it("skips a field with no resolvable DOM element and focuses the next invalid one", () => {
    const password = mountField("password");
    const focusPassword = vi.spyOn(password, "focus");
    const { result } = renderHook(() => useFormErrors<"groupIds" | "password">());

    act(() => {
      result.current.setErrors({ groupIds: "Select at least one security group", password: "Password is required" }, [
        { key: "groupIds", id: "groupIds" },
        { key: "password", id: "password" },
      ]);
    });

    expect(focusPassword).toHaveBeenCalledTimes(1);
  });

  it("clears prior errors and moves no focus on a passing validation", () => {
    const email = mountField("email");
    const focusEmail = vi.spyOn(email, "focus");
    const { result } = renderHook(() => useFormErrors<"email">());

    act(() => {
      result.current.setErrors({ email: "Email is required" }, [{ key: "email", id: "email" }]);
    });
    focusEmail.mockClear();

    act(() => {
      result.current.setErrors({}, [{ key: "email", id: "email" }]);
    });

    expect(result.current.errors).toEqual({});
    expect(focusEmail).not.toHaveBeenCalled();
  });

  it("clearError removes a single field's error without touching others", () => {
    const { result } = renderHook(() => useFormErrors<"email" | "password">());

    act(() => {
      result.current.setErrors({ email: "Email is required", password: "Password is required" }, []);
    });
    act(() => {
      result.current.clearError("email");
    });

    expect(result.current.errors).toEqual({ email: undefined, password: "Password is required" });
  });
});
