import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, TriangleAlert, Info, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const alertVariants = cva("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", {
  variants: {
    variant: {
      error: "border-destructive/30 bg-destructive/10 text-destructive",
      warning: "border-warning/30 bg-warning/10 text-warning-foreground",
      info: "border-info/30 bg-info/10 text-info-foreground",
      success: "border-success/30 bg-success/10 text-success-foreground",
    },
  },
  defaultVariants: {
    variant: "error",
  },
});

const variantIcon = {
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
  success: CircleCheck,
} as const;

interface AlertProps extends VariantProps<typeof alertVariants> {
  message?: string | null;
  children?: ReactNode;
  className?: string;
}

export function Alert({ variant = "error", message, children, className }: AlertProps) {
  if (!message && !children) return null;

  const Icon = variantIcon[variant ?? "error"];

  return (
    <p className={cn(alertVariants({ variant }), className)} role={variant === "error" ? "alert" : "status"}>
      <Icon className="size-4 shrink-0" />
      {message ?? children}
    </p>
  );
}
