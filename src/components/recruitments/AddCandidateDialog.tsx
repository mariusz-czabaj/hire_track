import { useState } from "react";
import { Mail, Phone, Plus, User } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useMutation } from "@/components/hooks/useMutation";
import type { AddCandidateCommand, CandidateCardDto } from "@/types";

interface AddCandidateDialogProps {
  recruitmentId: string;
  onChanged: () => void;
}

interface FormState {
  fullName: string;
  email: string;
  phone: string;
}

const EMPTY_FORM: FormState = { fullName: "", email: "", phone: "" };

export function AddCandidateDialog({ recruitmentId, onChanged }: AddCandidateDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const addCandidate = useMutation<AddCandidateCommand, CandidateCardDto>(
    `/api/recruitments/${encodeURIComponent(recruitmentId)}/candidates`,
    "POST",
  );

  function handleOpenChange(next: boolean) {
    if (next) {
      setForm(EMPTY_FORM);
      setLocalErrors({});
    }
    setOpen(next);
  }

  function fieldErrorFor(field: keyof FormState): string | undefined {
    return localErrors[field] ?? addCandidate.fieldErrors?.[field];
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!form.fullName.trim()) errors.fullName = "Full name is required";
    if (!form.email.trim()) errors.email = "Email is required";
    setLocalErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    try {
      await addCandidate.mutate({
        fullName: form.fullName,
        email: form.email,
        phone: form.phone.trim() || undefined,
      });
      onChanged();
      setOpen(false);
    } catch {
      // addCandidate.error/fieldErrors render the failure below.
    }
  }

  const saving = addCandidate.status === "loading";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" className="gap-2" data-testid="add-candidate-trigger">
          <Plus className="size-4" />
          Add candidate
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="add-candidate-dialog">
        <DialogHeader>
          <DialogTitle>Add candidate</DialogTitle>
          <DialogDescription>
            An existing candidate is matched by email; a new profile is created otherwise.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <FormField
            id="add-candidate-full-name"
            label="Full name"
            value={form.fullName}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, fullName: value }));
            }}
            error={fieldErrorFor("fullName")}
            icon={<User className="size-4" />}
          />
          <FormField
            id="add-candidate-email"
            label="Email"
            type="email"
            value={form.email}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, email: value }));
            }}
            error={fieldErrorFor("email")}
            icon={<Mail className="size-4" />}
          />
          <FormField
            id="add-candidate-phone"
            label="Phone (optional)"
            value={form.phone}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, phone: value }));
            }}
            error={fieldErrorFor("phone")}
            icon={<Phone className="size-4" />}
          />
        </div>

        <ServerError
          message={addCandidate.status === "error" && !addCandidate.fieldErrors ? addCandidate.error : null}
        />

        <DialogFooter>
          <Button
            type="button"
            disabled={saving}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {saving ? "Adding..." : "Add candidate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
