import { useState } from "react";
import { Briefcase, Building2, Calendar, MapPin, Plus, Users } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiResource } from "@/components/hooks/useApiResource";
import { useMutation } from "@/components/hooks/useMutation";
import {
  employmentTypeSchema,
  type CreateRecruitmentCommand,
  type EmploymentType,
  type RecruitmentListItemDto,
  type SecurityGroupDto,
} from "@/types";

const inputBase =
  "w-full rounded-lg bg-white/10 border px-3 py-2 pl-10 text-white placeholder-white/40 focus:outline-none focus:ring-2 transition-colors";

const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  "full-time": "Full-time",
  "part-time": "Part-time",
  contract: "Contract",
  internship: "Internship",
};

interface FormErrors {
  title?: string;
  department?: string;
  location?: string;
  openedAt?: string;
  groupIds?: string;
}

function validate(state: {
  title: string;
  department: string;
  location: string;
  openedAt: string;
  groupIds: number[];
}): FormErrors {
  const errors: FormErrors = {};
  if (!state.title.trim()) errors.title = "Title is required";
  if (!state.department.trim()) errors.department = "Department is required";
  if (!state.location.trim()) errors.location = "Location is required";
  if (!state.openedAt) errors.openedAt = "Opened date is required";
  if (state.groupIds.length === 0) errors.groupIds = "Select at least one security group";
  return errors;
}

export function CreateRecruitmentForm() {
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType>(employmentTypeSchema.options[0]);
  const [openedAt, setOpenedAt] = useState("");
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});

  const groupsResource = useApiResource<SecurityGroupDto[]>("/api/security-groups");
  const { mutate, status, error } = useMutation<CreateRecruitmentCommand, RecruitmentListItemDto>(
    "/api/recruitments",
    "POST",
  );

  function clearError(field: keyof FormErrors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function toggleGroup(groupId: number) {
    setGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
    clearError("groupIds");
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const nextErrors = validate({ title, department, location, openedAt, groupIds });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    try {
      const created = await mutate({ title, department, location, employmentType, openedAt, groupIds });
      window.location.href = `/recruitments/${created.id}`;
    } catch {
      // status/error state from useMutation renders the failure; nothing else to do here.
    }
  }

  const submitting = status === "loading";

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <FormField
        id="title"
        label="Title"
        value={title}
        onChange={(v) => {
          setTitle(v);
          clearError("title");
        }}
        placeholder="e.g. Backend Engineer"
        error={errors.title}
        icon={<Briefcase className="size-4" />}
      />

      <FormField
        id="department"
        label="Department"
        value={department}
        onChange={(v) => {
          setDepartment(v);
          clearError("department");
        }}
        placeholder="e.g. Engineering"
        error={errors.department}
        icon={<Building2 className="size-4" />}
      />

      <FormField
        id="location"
        label="Location"
        value={location}
        onChange={(v) => {
          setLocation(v);
          clearError("location");
        }}
        placeholder="e.g. Remote"
        error={errors.location}
        icon={<MapPin className="size-4" />}
      />

      <div>
        <label htmlFor="employmentType" className="mb-1 block text-sm text-blue-100/80">
          Employment type
        </label>
        <select
          id="employmentType"
          value={employmentType}
          onChange={(e) => {
            setEmploymentType(e.target.value as EmploymentType);
          }}
          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white focus:ring-2 focus:ring-purple-400 focus:outline-none"
        >
          {employmentTypeSchema.options.map((option) => (
            <option key={option} value={option} className="bg-slate-900">
              {EMPLOYMENT_TYPE_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      <FormField
        id="openedAt"
        label="Opened date"
        type="date"
        value={openedAt}
        onChange={(v) => {
          setOpenedAt(v);
          clearError("openedAt");
        }}
        error={errors.openedAt}
        icon={<Calendar className="size-4" />}
      />

      <div>
        <label className="mb-1 block text-sm text-blue-100/80">Security groups</label>
        <div
          className={inputBase.replace("pl-10", "pl-3") + (errors.groupIds ? " border-red-400/60" : " border-white/20")}
        >
          {groupsResource.status === "loading" && (
            <div className="flex flex-col gap-2 py-1">
              <Skeleton className="h-5 w-full bg-white/10" />
              <Skeleton className="h-5 w-full bg-white/10" />
            </div>
          )}
          {groupsResource.status === "error" && <ServerError message={groupsResource.message} />}
          {groupsResource.status === "success" && (
            <div className="flex flex-col gap-2 py-1">
              {groupsResource.data.map((group) => (
                <label key={group.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={groupIds.includes(group.id)}
                    onChange={() => {
                      toggleGroup(group.id);
                    }}
                    className="size-4 rounded border-white/30 bg-white/10"
                  />
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" />
                    {group.name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        {errors.groupIds ? <p className="mt-1 text-xs text-red-300">{errors.groupIds}</p> : null}
      </div>

      <ServerError message={status === "error" ? error : null} />

      <Button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
      >
        {submitting ? (
          <span className="flex items-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Creating...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Plus className="size-4" />
            Create recruitment
          </span>
        )}
      </Button>
    </form>
  );
}
