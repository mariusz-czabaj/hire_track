import { describe, expect, it } from "vitest";
import { contrastRatio, meetsAA } from "./contrast";

const WHITE = "oklch(1 0 0)";
const BLACK = "oklch(0 0 0)";

describe("contrastRatio", () => {
  it("returns 21:1 for white on black", () => {
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 0);
  });

  it("returns 1:1 for identical colors", () => {
    expect(contrastRatio("oklch(0.5 0.1 250)", "oklch(0.5 0.1 250)")).toBeCloseTo(1, 5);
  });

  it("is symmetric regardless of argument order", () => {
    const a = contrastRatio(WHITE, BLACK);
    const b = contrastRatio(BLACK, WHITE);
    expect(a).toBeCloseTo(b, 10);
  });

  it("flags a pair just above the AA threshold as passing", () => {
    // oklch(0.556 0 0) on white measures ~4.6:1 - just over the 4.5:1 AA threshold.
    const ratio = contrastRatio("oklch(0.556 0 0)", WHITE);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(meetsAA(ratio)).toBe(true);
  });

  it("flags a pair just below the AA threshold as failing", () => {
    // oklch(0.6 0 0) on white measures below 4.5:1.
    const ratio = contrastRatio("oklch(0.6 0 0)", WHITE);
    expect(ratio).toBeLessThan(4.5);
    expect(meetsAA(ratio)).toBe(false);
  });
});
