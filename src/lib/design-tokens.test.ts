import { describe, expect, it } from "vitest";
import { contrastRatio, meetsAA } from "./contrast";
import { lightPalette, darkPalette, tokenPairs } from "./design-tokens";

describe("tokenPairs contrast", () => {
  it.each(tokenPairs)("$label clears AA in light theme", (pair) => {
    const ratio = contrastRatio(lightPalette[pair.foreground], lightPalette[pair.background]);
    expect(meetsAA(ratio, pair.size)).toBe(true);
  });

  it.each(tokenPairs)("$label clears AA in dark theme", (pair) => {
    const ratio = contrastRatio(darkPalette[pair.foreground], darkPalette[pair.background]);
    expect(meetsAA(ratio, pair.size)).toBe(true);
  });
});
