/**
 * Token values duplicated from src/styles/global.css so the contrast measurement
 * in src/lib/contrast.ts can run without a browser (Astro SSR has no computed-style
 * access). Phase 5 re-measures against these same values as its closing gate — keep
 * this file in sync whenever a token value in global.css changes.
 */

export interface TokenPalette {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  stage1: string;
  stage1Foreground: string;
  stage2: string;
  stage2Foreground: string;
  stage3: string;
  stage3Foreground: string;
  stage4: string;
  stage4Foreground: string;
  stage5: string;
  stage5Foreground: string;
  stage6: string;
  stage6Foreground: string;
}

export const lightPalette: TokenPalette = {
  background: "oklch(1 0 0)",
  foreground: "oklch(0.145 0.01 275)",
  card: "oklch(1 0 0)",
  cardForeground: "oklch(0.145 0.01 275)",
  popover: "oklch(1 0 0)",
  popoverForeground: "oklch(0.145 0.01 275)",
  primary: "oklch(0.47 0.19 275)",
  primaryForeground: "oklch(0.99 0 0)",
  secondary: "oklch(0.96 0.01 275)",
  secondaryForeground: "oklch(0.25 0.02 275)",
  muted: "oklch(0.96 0.01 275)",
  mutedForeground: "oklch(0.44 0.02 275)",
  accent: "oklch(0.94 0.02 275)",
  accentForeground: "oklch(0.25 0.02 275)",
  destructive: "oklch(0.5 0.22 27.325)",
  destructiveForeground: "oklch(1 0 0)",
  sidebar: "oklch(0.985 0.005 275)",
  sidebarForeground: "oklch(0.145 0.01 275)",
  sidebarPrimary: "oklch(0.47 0.19 275)",
  sidebarPrimaryForeground: "oklch(0.99 0 0)",
  sidebarAccent: "oklch(0.94 0.02 275)",
  sidebarAccentForeground: "oklch(0.25 0.02 275)",
  stage1: "oklch(0.55 0.19 20)",
  stage1Foreground: "oklch(0.99 0 0)",
  stage2: "oklch(0.8 0.14 70)",
  stage2Foreground: "oklch(0.22 0.02 70)",
  stage3: "oklch(0.5 0.15 140)",
  stage3Foreground: "oklch(0.99 0 0)",
  stage4: "oklch(0.48 0.11 175)",
  stage4Foreground: "oklch(0.99 0 0)",
  stage5: "oklch(0.78 0.11 205)",
  stage5Foreground: "oklch(0.22 0.02 205)",
  stage6: "oklch(0.55 0.18 330)",
  stage6Foreground: "oklch(0.99 0 0)",
};

export const darkPalette: TokenPalette = {
  background: "oklch(0.16 0.01 275)",
  foreground: "oklch(0.96 0 0)",
  card: "oklch(0.2 0.015 275)",
  cardForeground: "oklch(0.96 0 0)",
  popover: "oklch(0.2 0.015 275)",
  popoverForeground: "oklch(0.96 0 0)",
  primary: "oklch(0.75 0.15 275)",
  primaryForeground: "oklch(0.16 0.03 275)",
  secondary: "oklch(0.27 0.02 275)",
  secondaryForeground: "oklch(0.96 0 0)",
  muted: "oklch(0.27 0.02 275)",
  mutedForeground: "oklch(0.72 0.01 275)",
  accent: "oklch(0.3 0.03 275)",
  accentForeground: "oklch(0.96 0 0)",
  destructive: "oklch(0.55 0.22 25)",
  destructiveForeground: "oklch(1 0 0)",
  sidebar: "oklch(0.19 0.015 275)",
  sidebarForeground: "oklch(0.96 0 0)",
  sidebarPrimary: "oklch(0.75 0.15 275)",
  sidebarPrimaryForeground: "oklch(0.16 0.03 275)",
  sidebarAccent: "oklch(0.27 0.02 275)",
  sidebarAccentForeground: "oklch(0.96 0 0)",
  stage1: "oklch(0.52 0.19 20)",
  stage1Foreground: "oklch(0.99 0 0)",
  stage2: "oklch(0.8 0.14 70)",
  stage2Foreground: "oklch(0.2 0.02 70)",
  stage3: "oklch(0.47 0.15 140)",
  stage3Foreground: "oklch(0.99 0 0)",
  stage4: "oklch(0.45 0.11 175)",
  stage4Foreground: "oklch(0.99 0 0)",
  stage5: "oklch(0.8 0.11 205)",
  stage5Foreground: "oklch(0.18 0.02 205)",
  stage6: "oklch(0.5 0.18 330)",
  stage6Foreground: "oklch(0.99 0 0)",
};

export interface TokenPair {
  label: string;
  size: "normal" | "large";
  foreground: keyof TokenPalette;
  background: keyof TokenPalette;
}

/** Every "text token on background token" pair actually consumed by src/components/ui/*. */
export const tokenPairs: TokenPair[] = [
  { label: "foreground / background", size: "normal", foreground: "foreground", background: "background" },
  { label: "muted-foreground / background", size: "normal", foreground: "mutedForeground", background: "background" },
  { label: "card-foreground / card", size: "normal", foreground: "cardForeground", background: "card" },
  { label: "popover-foreground / popover", size: "normal", foreground: "popoverForeground", background: "popover" },
  { label: "primary-foreground / primary", size: "normal", foreground: "primaryForeground", background: "primary" },
  {
    label: "secondary-foreground / secondary",
    size: "normal",
    foreground: "secondaryForeground",
    background: "secondary",
  },
  { label: "accent-foreground / accent", size: "normal", foreground: "accentForeground", background: "accent" },
  {
    label: "destructive-foreground (white) / destructive",
    size: "normal",
    foreground: "destructiveForeground",
    background: "destructive",
  },
  { label: "sidebar-foreground / sidebar", size: "normal", foreground: "sidebarForeground", background: "sidebar" },
  {
    label: "sidebar-primary-foreground / sidebar-primary",
    size: "normal",
    foreground: "sidebarPrimaryForeground",
    background: "sidebarPrimary",
  },
  {
    label: "sidebar-accent-foreground / sidebar-accent",
    size: "normal",
    foreground: "sidebarAccentForeground",
    background: "sidebarAccent",
  },
  { label: "stage-1-foreground / stage-1", size: "normal", foreground: "stage1Foreground", background: "stage1" },
  { label: "stage-2-foreground / stage-2", size: "normal", foreground: "stage2Foreground", background: "stage2" },
  { label: "stage-3-foreground / stage-3", size: "normal", foreground: "stage3Foreground", background: "stage3" },
  { label: "stage-4-foreground / stage-4", size: "normal", foreground: "stage4Foreground", background: "stage4" },
  { label: "stage-5-foreground / stage-5", size: "normal", foreground: "stage5Foreground", background: "stage5" },
  { label: "stage-6-foreground / stage-6", size: "normal", foreground: "stage6Foreground", background: "stage6" },
];
