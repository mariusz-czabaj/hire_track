import { useMemo, useState } from "react";
import { Download, Mail, Pencil, Phone } from "lucide-react";
import { useApiResource } from "@/components/hooks/useApiResource";
import { useMutation } from "@/components/hooks/useMutation";
import { useCvUpload } from "@/components/hooks/useCvUpload";
import { ServerError } from "@/components/auth/ServerError";
import { FormField } from "@/components/auth/FormField";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileInput } from "@/components/ui/file-input";
import type { CandidateProfileDto, UpdateCandidateProfileCommand } from "@/types";

interface CandidateProfileProps {
  candidateId: string | undefined;
}

const CV_ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-CA");
}

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

function SkeletonProfile() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-48 bg-white/10" />
      <Skeleton className="h-24 w-full rounded-lg bg-white/10" />
      <Skeleton className="h-24 w-full rounded-lg bg-white/10" />
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-10 text-center text-blue-100/70">
      <p>This candidate could not be found.</p>
    </div>
  );
}

interface CvPanelProps {
  candidateId: string;
  cv: CandidateProfileDto["cv"];
  onUploaded: () => Promise<void>;
}

function CvPanel({ candidateId, cv, onUploaded }: CvPanelProps) {
  const cvUpload = useCvUpload(candidateId);

  async function handleFileSelected(file: File) {
    const uploaded = await cvUpload.upload(file);
    if (uploaded) {
      await onUploaded();
    }
  }

  const showUploadControl = cv === null || cv.state === "expired";

  return (
    <Card className="flex flex-col gap-3 border-white/10 bg-white/5 p-4 text-white">
      <h2 className="text-sm font-semibold text-blue-100/90">CV</h2>

      {cv?.state === "available" && (
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm text-blue-100/90">{cv.originalFilename}</p>
            <p className="text-xs text-blue-100/50">
              {formatSize(cv.sizeBytes)} &middot; uploaded {formatDate(cv.uploadedAt)}
            </p>
          </div>
          <a
            href={`/api/candidates/${candidateId}/cv`}
            className="inline-flex items-center gap-1 text-sm text-purple-300 hover:underline"
          >
            <Download className="size-4" />
            Download
          </a>
        </div>
      )}

      {cv?.state === "expired" && (
        <p className="text-sm text-blue-100/70">
          This CV was removed after 12 months, on {formatDate(cv.expiresAt)}. It was originally uploaded on{" "}
          {formatDate(cv.uploadedAt)}.
        </p>
      )}

      {cv === null && <p className="text-sm text-blue-100/40 italic">No CV uploaded yet</p>}

      {showUploadControl && (
        <div className="flex flex-col gap-2">
          <FileInput
            id={`cv-upload-${candidateId}`}
            label="Upload CV (PDF or DOCX, up to 5 MB)"
            accept={CV_ACCEPT}
            disabled={cvUpload.status === "loading"}
            error={cvUpload.fieldErrors ? undefined : (cvUpload.error ?? undefined)}
            onFileSelected={(file) => {
              void handleFileSelected(file);
            }}
          />
        </div>
      )}
    </Card>
  );
}

export function CandidateProfile({ candidateId }: CandidateProfileProps) {
  const url = useMemo(() => `/api/candidates/${encodeURIComponent(candidateId ?? "")}`, [candidateId]);
  const resource = useApiResource<CandidateProfileDto>(url);
  const updateProfile = useMutation<UpdateCandidateProfileCommand, CandidateProfileDto>(url, "PATCH");

  const [editing, setEditing] = useState(false);
  const [draftFullName, setDraftFullName] = useState("");
  const [draftPhone, setDraftPhone] = useState("");

  if (resource.status === "loading") {
    return <SkeletonProfile />;
  }

  if (resource.status === "not-found") {
    return <NotFoundState />;
  }

  if (resource.status === "error") {
    return <ServerError message={resource.message} />;
  }

  const { data: candidate } = resource;

  function startEdit() {
    setDraftFullName(candidate.fullName);
    setDraftPhone(candidate.phone ?? "");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  async function saveEdit() {
    try {
      await updateProfile.mutate({ fullName: draftFullName, phone: draftPhone || undefined });
      setEditing(false);
      await resource.refetch();
    } catch {
      // updateProfile.error/fieldErrors render the failure below.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        {editing ? (
          <div className="flex flex-col gap-3">
            <FormField
              id="candidate-full-name"
              label="Full name"
              value={draftFullName}
              onChange={setDraftFullName}
              error={updateProfile.fieldErrors?.fullName}
              icon={<Mail className="size-4" />}
            />
            <FormField
              id="candidate-phone"
              label="Phone"
              value={draftPhone}
              onChange={setDraftPhone}
              error={updateProfile.fieldErrors?.phone}
              icon={<Phone className="size-4" />}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={updateProfile.status === "loading"}
                onClick={() => void saveEdit()}
              >
                {updateProfile.status === "loading" ? "Saving..." : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={updateProfile.status === "loading"}
                onClick={cancelEdit}
              >
                Cancel
              </Button>
            </div>
            {updateProfile.status === "error" && !updateProfile.fieldErrors && (
              <ServerError message={updateProfile.error} />
            )}
          </div>
        ) : (
          <>
            <h1 className="bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-2xl font-bold text-transparent">
              {candidate.fullName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-blue-100/70">
              <span className="flex items-center gap-1">
                <Mail className="size-4" />
                {candidate.email}
              </span>
              {candidate.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="size-4" />
                  {candidate.phone}
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Edit candidate details"
                onClick={startEdit}
              >
                <Pencil className="size-4" />
              </Button>
            </div>
          </>
        )}
      </div>

      <Card className="flex flex-col gap-2 border-white/10 bg-white/5 p-4 text-white">
        <h2 className="text-sm font-semibold text-blue-100/90">Recruitments</h2>
        {candidate.recruitments.length === 0 ? (
          <p className="text-sm text-blue-100/40 italic">Not part of any recruitment yet</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {candidate.recruitments.map((r) => (
              <li key={r.candidateRecruitmentId}>
                <a
                  href={`/recruitments/${r.recruitmentId}/candidates/${r.candidateRecruitmentId}`}
                  className="text-sm text-purple-300 hover:underline"
                >
                  {r.title} &mdash; {r.stageName}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {candidateId && <CvPanel candidateId={candidateId} cv={candidate.cv} onUploaded={resource.refetch} />}
    </div>
  );
}
