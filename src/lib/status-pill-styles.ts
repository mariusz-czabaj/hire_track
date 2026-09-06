import { cn } from "@/lib/utils";

export function statusPillClasses({
  active,
  disabled,
  size,
  activeColor = "accent",
}: {
  active: boolean;
  disabled?: boolean;
  size: "default" | "sm";
  activeColor?: "accent" | "green";
}): string {
  return cn(
    "rounded-full border font-medium transition-colors",
    size === "default" ? "px-4 py-1.5 text-sm" : "px-3 py-1 text-xs",
    active
      ? activeColor === "green"
        ? "border-green-600 bg-green-600 text-white"
        : "border-accent bg-accent text-accent-foreground"
      : "border-border bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
    disabled && "disabled:opacity-50",
  );
}
