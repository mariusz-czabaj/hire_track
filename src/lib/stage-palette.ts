const STAGE_PALETTE_SIZE = 6;

export interface StagePaletteClasses {
  background: string;
  foreground: string;
}

const STAGE_CLASSES: StagePaletteClasses[] = [
  { background: "bg-stage-1", foreground: "text-stage-1-foreground" },
  { background: "bg-stage-2", foreground: "text-stage-2-foreground" },
  { background: "bg-stage-3", foreground: "text-stage-3-foreground" },
  { background: "bg-stage-4", foreground: "text-stage-4-foreground" },
  { background: "bg-stage-5", foreground: "text-stage-5-foreground" },
  { background: "bg-stage-6", foreground: "text-stage-6-foreground" },
];

/**
 * Maps a stage's sortOrder to a stage-token pair deterministically and cyclically.
 * sortOrder is not guaranteed to be zero-based, contiguous, or non-negative — the
 * modulo below is normalized to stay in range for any integer input.
 */
export function stageClassesForSortOrder(sortOrder: number): StagePaletteClasses {
  const index = ((sortOrder % STAGE_PALETTE_SIZE) + STAGE_PALETTE_SIZE) % STAGE_PALETTE_SIZE;
  return STAGE_CLASSES[index];
}
