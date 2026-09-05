import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SidebarToggleProps {
  collapsed: boolean;
}

export function SidebarToggle({ collapsed }: SidebarToggleProps) {
  const [isSaving, setIsSaving] = useState(false);
  const nextCollapsed = !collapsed;

  async function handleToggle() {
    setIsSaving(true);
    try {
      const response = await fetch("/api/preferences/sidebar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collapsed: nextCollapsed ? "true" : "false" }),
      });
      if (!response.ok) {
        setIsSaving(false);
        return;
      }
      window.location.reload();
    } catch {
      setIsSaving(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={handleToggle}
      disabled={isSaving}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      className="hidden md:inline-flex"
    >
      {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
    </Button>
  );
}
