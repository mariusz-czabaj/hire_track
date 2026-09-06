import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface TextareaProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  rows?: number;
  required?: boolean;
}

// Mirrors ui/form-field's label/id pairing and inline error markup (no icon --
// notes are multi-line and don't need one) so getByLabel works the same
// way in both RTL and Playwright.
export function Textarea({ id, label, value, onChange, placeholder, error, rows = 4, required }: TextareaProps) {
  return (
    <div>
      <label htmlFor={id} className="text-muted-foreground mb-1 block text-sm">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="text-destructive-text ml-0.5">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </label>
      <textarea
        id={id}
        name={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        rows={rows}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-required={required}
        className={cn(
          "bg-input/30 text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2 transition-colors focus:ring-2 focus:outline-none",
          error ? "border-destructive focus:ring-destructive" : "border-input focus:ring-ring",
        )}
      />
      {error && (
        <p id={`${id}-error`} className="text-destructive-text mt-1 flex items-center gap-1 text-xs">
          <CircleAlert className="size-3" />
          {error}
        </p>
      )}
    </div>
  );
}
