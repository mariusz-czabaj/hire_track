import { useEffect, useState } from "react";
import { Briefcase, Building2, Calendar, MapPin } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { useMutation } from "@/components/hooks/useMutation";
import { useFormErrors, focusFirstInvalidField, type FieldOrderEntry } from "@/components/hooks/useFormErrors";
import { toast } from "@/lib/toast-store";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/employment-type";
import { editRecruitmentDetailsSchema } from "@/lib/validation/recruitment";
import { dispatchRecruitmentDetailsChanged } from "@/lib/recruitment-details-events";
import {
  employmentTypeSchema,
  type EmploymentType,
  type RecruitmentDetailDto,
  type UpdateRecruitmentDetailsCommand,
} from "@/types";

interface EditRecruitmentDialogProps {
  recruitment: RecruitmentDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (recruitment: RecruitmentDetailDto) => void;
}

type ErrorKey = "title" | "department" | "location" | "openedAt";
type FormErrors = Partial<Record<ErrorKey, string>>;

const FIELD_ORDER: FieldOrderEntry<ErrorKey>[] = [
  { key: "title", id: "edit-recruitment-title" },
  { key: "department", id: "edit-recruitment-department" },
  { key: "location", id: "edit-recruitment-location" },
  { key: "openedAt", id: "edit-recruitment-openedAt" },
];

function validate(state: {
  title: string;
  department: string | null;
  location: string | null;
  employmentType: EmploymentType | null;
  openedAt: string | null;
}): FormErrors {
  const errors: FormErrors = {};
  const parsed = editRecruitmentDetailsSchema.safeParse(state);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") as ErrorKey;
      errors[key] ??= issue.message;
    }
  }
  return errors;
}

// Mounted only while the dialog is open, seeded from the current recruitment
// each time so a re-open always reflects the latest header state.
function EditRecruitmentForm({
  recruitment,
  onSaved,
}: {
  recruitment: RecruitmentDetailDto;
  onSaved: (recruitment: RecruitmentDetailDto) => void;
}) {
  const [title, setTitle] = useState(recruitment.title);
  const [department, setDepartment] = useState(recruitment.department ?? "");
  const [location, setLocation] = useState(recruitment.location ?? "");
  const [employmentType, setEmploymentType] = useState<EmploymentType | "">(recruitment.employmentType ?? "");
  const [openedAt, setOpenedAt] = useState(recruitment.openedAt ?? "");
  const { errors, setErrors, clearError } = useFormErrors<ErrorKey>();

  const { mutate, status, error, fieldErrors } = useMutation<UpdateRecruitmentDetailsCommand, RecruitmentDetailDto>(
    `/api/recruitments/${encodeURIComponent(String(recruitment.id))}`,
    "PATCH",
  );

  useEffect(() => {
    if (fieldErrors) {
      focusFirstInvalidField(fieldErrors as FormErrors, FIELD_ORDER);
    }
  }, [fieldErrors]);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const command: UpdateRecruitmentDetailsCommand = {
      title,
      department: department.trim() === "" ? null : department,
      location: location.trim() === "" ? null : location,
      employmentType: employmentType === "" ? null : employmentType,
      openedAt: openedAt.trim() === "" ? null : openedAt,
    };
    const nextErrors = validate(command);
    setErrors(nextErrors, FIELD_ORDER);
    if (Object.keys(nextErrors).length > 0) return;

    try {
      const updated = await mutate(command);
      toast({ variant: "success", message: "Recruitment updated." });
      onSaved(updated);
    } catch {
      // status/error/fieldErrors state from useMutation renders the failure below.
    }
  }

  const saving = status === "loading";

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <FormField
        id="edit-recruitment-title"
        label="Title"
        value={title}
        onChange={(v) => {
          setTitle(v);
          clearError("title");
        }}
        error={errors.title ?? fieldErrors?.title}
        icon={<Briefcase className="size-4" />}
        required
      />

      <FormField
        id="edit-recruitment-department"
        label="Department"
        value={department}
        onChange={(v) => {
          setDepartment(v);
          clearError("department");
        }}
        error={errors.department ?? fieldErrors?.department}
        icon={<Building2 className="size-4" />}
      />

      <FormField
        id="edit-recruitment-location"
        label="Location"
        value={location}
        onChange={(v) => {
          setLocation(v);
          clearError("location");
        }}
        error={errors.location ?? fieldErrors?.location}
        icon={<MapPin className="size-4" />}
      />

      <div>
        <label htmlFor="edit-recruitment-employmentType" className="text-muted-foreground mb-1 block text-sm">
          Employment type
        </label>
        <select
          id="edit-recruitment-employmentType"
          value={employmentType}
          onChange={(e) => {
            setEmploymentType(e.target.value as EmploymentType | "");
          }}
          className="border-input bg-input/30 text-foreground focus:ring-ring w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
        >
          <option value="" className="bg-popover text-popover-foreground">
            Not set
          </option>
          {employmentTypeSchema.options.map((option) => (
            <option key={option} value={option} className="bg-popover text-popover-foreground">
              {EMPLOYMENT_TYPE_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      <FormField
        id="edit-recruitment-openedAt"
        label="Opened date"
        type="date"
        value={openedAt}
        onChange={(v) => {
          setOpenedAt(v);
          clearError("openedAt");
        }}
        error={errors.openedAt ?? fieldErrors?.openedAt}
        icon={<Calendar className="size-4" />}
      />

      <Alert variant="error" message={status === "error" && !fieldErrors ? error : null} />

      <DialogFooter>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function EditRecruitmentDialog({ recruitment, open, onOpenChange, onSaved }: EditRecruitmentDialogProps) {
  function handleSaved(updated: RecruitmentDetailDto) {
    dispatchRecruitmentDetailsChanged({ recruitmentId: String(updated.id), recruitment: updated });
    onSaved(updated);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="edit-recruitment-dialog">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>
            Update this recruitment&apos;s title, department, location, employment type and opened date.
          </DialogDescription>
        </DialogHeader>

        {open && <EditRecruitmentForm recruitment={recruitment} onSaved={handleSaved} />}
      </DialogContent>
    </Dialog>
  );
}
