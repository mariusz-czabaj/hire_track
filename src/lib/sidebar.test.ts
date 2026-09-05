import { describe, expect, it } from "vitest";
import { resolveSidebarCollapsed } from "./sidebar";

describe("resolveSidebarCollapsed", () => {
  it("returns false for an absent cookie", () => {
    expect(resolveSidebarCollapsed(undefined)).toBe(false);
  });

  it("returns false for a malformed cookie value", () => {
    expect(resolveSidebarCollapsed("nonsense")).toBe(false);
  });

  it("resolves 'true' to collapsed", () => {
    expect(resolveSidebarCollapsed("true")).toBe(true);
  });

  it("resolves 'false' to expanded", () => {
    expect(resolveSidebarCollapsed("false")).toBe(false);
  });
});
