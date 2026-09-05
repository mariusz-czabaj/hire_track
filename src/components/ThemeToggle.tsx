import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ThemeToggleProps {
  theme: "light" | "dark" | null;
}

export function ThemeToggle({ theme }: ThemeToggleProps) {
  const [isSaving, setIsSaving] = useState(false);
  const isDark = theme === "dark";
  const nextTheme = isDark ? "light" : "dark";

  async function handleToggle() {
    setIsSaving(true);
    try {
      await fetch("/api/preferences/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: nextTheme }),
      });
      window.location.reload();
    } catch {
      setIsSaving(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleToggle}
      disabled={isSaving}
      aria-label={`Switch to ${nextTheme} theme`}
    >
      {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
      <span>{isDark ? "Dark theme" : "Light theme"}</span>
    </Button>
  );
}
