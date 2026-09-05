import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("resolves 'light'", () => {
    expect(resolveTheme("light")).toBe("light");
  });

  it("resolves 'dark'", () => {
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("returns null for undefined (follow the system)", () => {
    expect(resolveTheme(undefined)).toBeNull();
  });

  it("returns null for an unknown value instead of throwing", () => {
    expect(() => resolveTheme("solarized")).not.toThrow();
    expect(resolveTheme("solarized")).toBeNull();
  });
});
