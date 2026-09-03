import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileInputProps {
  id: string;
  label: string;
  accept?: string;
  error?: string;
  disabled?: boolean;
  onFileSelected: (file: File) => void;
}

// Mirrors Textarea/FormField's label/id pairing and inline error markup so
// getByLabelText works the same way in both RTL and Playwright.
export function FileInput({ id, label, accept, error, disabled, onFileSelected }: FileInputProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-blue-100/80">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
          e.target.value = "";
        }}
        className={cn(
          "block w-full text-sm text-blue-100/80 file:mr-3 file:rounded-lg file:border-0 file:bg-purple-500/30 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-purple-500/40",
          "rounded-lg border bg-white/10 px-3 py-2 transition-colors focus:ring-2 focus:outline-none",
          error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
        )}
      />
      {error && (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3" />
          {error}
        </p>
      )}
    </div>
  );
}
