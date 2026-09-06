import { useMemo, useState } from "react";
import { Download, Mail, Pencil, Phone, Repeat } from "lucide-react";
import { useApiResource } from "@/components/hooks/useApiResource";
import { useMutation } from "@/components/hooks/useMutation";
import { useCvUpload } from "@/components/hooks/useCvUpload";
import { ServerError } from "@/components/auth/ServerError";
import { FormField } from "@/components/auth/FormField";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileInput } from "@/components/ui/file-input";
import type { CandidateProfileDto, CandidateStatusHistoryEntryDto, UpdateCandidateProfileCommand } from "@/types";

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
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="border-border bg-muted text-muted-foreground rounded-xl border px-4 py-10 text-center">
      <p>This candidate could not be found.</p>
    </div>
  );
}

function HistoryEntry({ entry }: { entry: CandidateStatusHistoryEntryDto }) {
  return (
    <li className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
      <span>
        {entry.fromStageName === null
          ? `Added to ${entry.toStageName}`
          : `${entry.fromStageName} → ${entry.toStageName}`}
      </span>
      <span>{formatDate(entry.changedAt)}</span>
    </li>
  );
}

interface CvPanelProps {
  candidateId: string;
  cv: CandidateProfileDto["cv"];
  onUploaded: () => Promise<void>;
}

function CvPanel({ candidateId, cv, onUploaded }: CvPanelProps) {
  const cvUpload = useCvUpload(candidateId);
  const [replacing, setReplacing] = useState(false);

  async function handleFileSelected(file: File) {
    const uploaded = await cvUpload.upload(file);
    if (uploaded) {
      setReplacing(false);
      await onUploaded();
    }
  }

  const showUploadControl = cv === null || cv.state === "expired" || replacing;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-foreground text-sm font-semibold">CV</h2>

      {cv?.state === "available" && (
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-foreground text-sm">{cv.originalFilename}</p>
            <p className="text-muted-foreground text-xs">
              {formatSize(cv.sizeBytes)} &middot; uploaded {formatDate(cv.uploadedAt)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`/api/candidates/${candidateId}/cv`}
              className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
            >
              <Download className="size-4" />
              Download
            </a>
            {!replacing && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setReplacing(true);
                }}
                className="gap-1"
              >
                <Repeat className="size-4" />
                Replace
              </Button>
            )}
          </div>
        </div>
      )}

      {cv?.state === "expired" && (
        <p className="text-muted-foreground text-sm">
          This CV was removed after 12 months, on {formatDate(cv.expiresAt)}. It was originally uploaded on{" "}
          {formatDate(cv.uploadedAt)}.
        </p>
      )}

      {cv === null && <p className="text-muted-foreground text-sm italic">No CV uploaded yet</p>}

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
          {replacing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setReplacing(false);
              }}
              className="self-start"
            >
              Cancel
            </Button>
          )}
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
            <h1 className="text-foreground text-2xl font-bold">{candidate.fullName}</h1>
            <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-4 text-sm">
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

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="text-foreground text-sm font-semibold">Recruitments</h2>
        {candidate.recruitments.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">Not part of any recruitment yet</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {candidate.recruitments.map((r) => (
              <li key={r.candidateRecruitmentId}>
                <a
                  href={`/recruitments/${r.recruitmentId}/candidates/${r.candidateRecruitmentId}`}
                  className="text-primary text-sm hover:underline"
                >
                  {r.title} &mdash; {r.stageName}
                </a>
                {r.history.length === 0 ? (
                  <p className="text-muted-foreground mt-1 text-xs italic">No status history yet</p>
                ) : (
                  <ul className="border-border mt-1 flex flex-col gap-0.5 border-l pl-3">
                    {r.history.map((entry) => (
                      <HistoryEntry key={entry.id} entry={entry} />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {candidateId && <CvPanel candidateId={candidateId} cv={candidate.cv} onUploaded={resource.refetch} />}
    </div>
  );
}
