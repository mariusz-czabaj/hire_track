/**
 * WCAG 2.1 contrast ratio for oklch() color strings, as used by the design tokens
 * in src/styles/global.css. Conversion follows Björn Ottosson's OKLab reference
 * (https://bottosson.github.io/posts/oklab/) down to linear sRGB, then the
 * standard WCAG relative-luminance formula.
 */

interface Oklch {
  l: number;
  c: number;
  h: number;
}

function parseOklch(color: string): Oklch {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(color.trim());
  if (!match) {
    throw new Error(`Not an oklch() color: "${color}"`);
  }
  const [, l, c, h] = match;
  return { l: Number(l), c: Number(c), h: Number(h) };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** oklch -> linear sRGB, each channel clamped to [0, 1] (out-of-gamut colors are clipped). */
function oklchToLinearSrgb({ l, c, h }: Oklch): [number, number, number] {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;

  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bChannel = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  return [clamp01(r), clamp01(g), clamp01(bChannel)];
}

/** WCAG relative luminance, computed directly from linear-light RGB. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two oklch() colors per WCAG 2.1 (relative luminance),
 * in the range [1, 21].
 */
export function contrastRatio(colorA: string, colorB: string): number {
  const lumA = relativeLuminance(oklchToLinearSrgb(parseOklch(colorA)));
  const lumB = relativeLuminance(oklchToLinearSrgb(parseOklch(colorB)));
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

export const WCAG_AA_NORMAL_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3;

export function meetsAA(ratio: number, size: "normal" | "large" = "normal"): boolean {
  return ratio >= (size === "normal" ? WCAG_AA_NORMAL_TEXT : WCAG_AA_LARGE_TEXT);
}
