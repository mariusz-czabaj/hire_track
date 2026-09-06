import { useState } from "react";
import { Mail, Phone, Plus, User } from "lucide-react";
import { FormField } from "@/components/ui/form-field";
import { FileInput } from "@/components/ui/file-input";
import { Alert } from "@/components/ui/alert";
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
import { useCvUpload } from "@/components/hooks/useCvUpload";
import { useFormErrors, type FieldOrderEntry } from "@/components/hooks/useFormErrors";
import { toast } from "@/lib/toast-store";
import type { AddCandidateCommand, CandidateCardDto } from "@/types";

const CV_ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface AddCandidateDialogProps {
  recruitmentId: string;
  onChanged: () => void;
}

interface FormState {
  fullName: string;
  email: string;
  phone: string;
}

type ErrorKey = keyof FormState;

const FIELD_ORDER: FieldOrderEntry<ErrorKey>[] = [
  { key: "fullName", id: "add-candidate-full-name" },
  { key: "email", id: "add-candidate-email" },
  { key: "phone", id: "add-candidate-phone" },
];

const EMPTY_FORM: FormState = { fullName: "", email: "", phone: "" };

export function AddCandidateDialog({ recruitmentId, onChanged }: AddCandidateDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const { errors: localErrors, setErrors: setLocalErrors } = useFormErrors<ErrorKey>();

  const addCandidate = useMutation<AddCandidateCommand, CandidateCardDto>(
    `/api/recruitments/${encodeURIComponent(recruitmentId)}/candidates`,
    "POST",
  );
  const cvUpload = useCvUpload();

  function handleOpenChange(next: boolean) {
    if (next) {
      setForm(EMPTY_FORM);
      setCvFile(null);
      setLocalErrors({}, FIELD_ORDER);
    }
    setOpen(next);
  }

  function fieldErrorFor(field: ErrorKey): string | undefined {
    return localErrors[field] ?? addCandidate.fieldErrors?.[field];
  }

  function validate(): boolean {
    const errors: Partial<Record<ErrorKey, string>> = {};
    if (!form.fullName.trim()) errors.fullName = "Full name is required";
    if (!form.email.trim()) errors.email = "Email is required";
    setLocalErrors(errors, FIELD_ORDER);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    try {
      const candidate = await addCandidate.mutate({
        fullName: form.fullName,
        email: form.email,
        phone: form.phone.trim() || undefined,
      });
      if (cvFile) {
        await cvUpload.upload(String(candidate.id), cvFile);
      }
      toast({ variant: "success", message: "Candidate added." });
      onChanged();
      setOpen(false);
    } catch {
      // addCandidate.error/fieldErrors render the failure below.
    }
  }

  const saving = addCandidate.status === "loading" || cvUpload.status === "loading";

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
            required
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
            required
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
          <FileInput
            id="add-candidate-cv"
            label="CV (optional, PDF or DOCX, up to 5 MB)"
            accept={CV_ACCEPT}
            disabled={saving}
            error={cvUpload.fieldErrors ? undefined : (cvUpload.error ?? undefined)}
            onFileSelected={setCvFile}
          />
          {cvFile && <p className="text-muted-foreground text-xs">Selected: {cvFile.name}</p>}
        </div>

        <Alert
          variant="error"
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
