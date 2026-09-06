import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileInputProps {
  id: string;
  label: string;
  accept?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  onFileSelected: (file: File) => void;
}

// Mirrors Textarea/ui/form-field's label/id pairing and inline error markup so
// getByLabelText works the same way in both RTL and Playwright.
export function FileInput({ id, label, accept, error, disabled, required, onFileSelected }: FileInputProps) {
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
      <input
        id={id}
        name={id}
        type="file"
        accept={accept}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-required={required}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
          e.target.value = "";
        }}
        className={cn(
          "text-muted-foreground file:bg-primary/20 hover:file:bg-primary/30 file:text-foreground block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-2 file:text-sm",
          "bg-input/30 rounded-lg border px-3 py-2 transition-colors focus:ring-2 focus:outline-none",
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
