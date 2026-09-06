import { describe, expect, it } from "vitest";
import { stageClassesForSortOrder } from "./stage-palette";

describe("stageClassesForSortOrder", () => {
  it("returns the same classes for the same sortOrder", () => {
    expect(stageClassesForSortOrder(2)).toEqual(stageClassesForSortOrder(2));
  });

  it("wraps past the palette size back to the first hue", () => {
    expect(stageClassesForSortOrder(6)).toEqual(stageClassesForSortOrder(0));
    expect(stageClassesForSortOrder(7)).toEqual(stageClassesForSortOrder(1));
  });

  it("never returns the same classes for adjacent sortOrder values", () => {
    for (let i = 0; i < 12; i++) {
      expect(stageClassesForSortOrder(i)).not.toEqual(stageClassesForSortOrder(i + 1));
    }
  });

  it("handles a zero-based sortOrder", () => {
    expect(stageClassesForSortOrder(0)).toEqual({ background: "bg-stage-1", foreground: "text-stage-1-foreground" });
  });

  it("handles a one-based sortOrder", () => {
    expect(stageClassesForSortOrder(1)).toEqual({ background: "bg-stage-2", foreground: "text-stage-2-foreground" });
  });

  it("handles a non-contiguous sortOrder", () => {
    expect(stageClassesForSortOrder(11)).toEqual({
      background: "bg-stage-6",
      foreground: "text-stage-6-foreground",
    });
  });

  it("handles a negative sortOrder without returning undefined", () => {
    expect(stageClassesForSortOrder(-1)).toEqual({
      background: "bg-stage-6",
      foreground: "text-stage-6-foreground",
    });
    expect(stageClassesForSortOrder(-6)).toEqual({
      background: "bg-stage-1",
      foreground: "text-stage-1-foreground",
    });
  });
});
