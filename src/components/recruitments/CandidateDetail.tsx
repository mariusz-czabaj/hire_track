import { useMemo, useState } from "react";
import { Mail, Pencil, Phone, User } from "lucide-react";
import { useApiResource } from "@/components/hooks/useApiResource";
import { useMutation } from "@/components/hooks/useMutation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { CandidateDetailDto, CandidateNoteDto, UpsertCandidateNoteCommand } from "@/types";

interface CandidateDetailProps {
  recruitmentId: string | undefined;
  candidateRecruitmentId: string | undefined;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-CA");
}

function SkeletonDetail() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full rounded-lg" />
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

interface NoteCardProps {
  note: CandidateNoteDto;
  isCurrentStage: boolean;
  isEditing: boolean;
  draftBody: string;
  onDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  saving: boolean;
  error?: string;
}

function NoteCard({
  note,
  isCurrentStage,
  isEditing,
  draftBody,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  onSave,
  saving,
  error,
}: NoteCardProps) {
  return (
    <Card className="gap-2 p-4" data-testid={`note-${note.stageId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-sm font-semibold">{note.stageName}</span>
          {isCurrentStage && (
            <span className="border-accent bg-accent text-accent-foreground rounded-full border px-2 py-0.5 text-xs">
              Current stage
            </span>
          )}
        </div>
        {note.authorEmail && note.updatedAt && (
          <span className="text-muted-foreground text-xs">
            {note.authorEmail} &middot; {formatDateTime(note.updatedAt)}
          </span>
        )}
      </div>

      {isEditing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            id={`note-edit-${note.stageId}`}
            label={`Note for ${note.stageName}`}
            value={draftBody}
            onChange={onDraftChange}
            error={error}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={saving} onClick={onSave}>
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          {note.body !== null ? (
            <p className="text-foreground text-sm">{note.body}</p>
          ) : (
            <p className="text-muted-foreground text-sm italic">No note yet</p>
          )}
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Edit note for ${note.stageName}`}
            onClick={onStartEdit}
          >
            <Pencil className="size-4" />
          </Button>
        </div>
      )}
    </Card>
  );
}

export function CandidateDetail({ recruitmentId, candidateRecruitmentId }: CandidateDetailProps) {
  const url = useMemo(
    () =>
      `/api/recruitments/${encodeURIComponent(recruitmentId ?? "")}/candidates/${encodeURIComponent(candidateRecruitmentId ?? "")}`,
    [recruitmentId, candidateRecruitmentId],
  );
  const resource = useApiResource<CandidateDetailDto>(url);
  const upsertNote = useMutation<UpsertCandidateNoteCommand, CandidateNoteDto>(`${url}/notes`, "PUT");

  const [editingStageId, setEditingStageId] = useState<number | null>(null);
  const [draftBody, setDraftBody] = useState("");

  if (resource.status === "loading") {
    return <SkeletonDetail />;
  }

  if (resource.status === "not-found") {
    return <NotFoundState />;
  }

  if (resource.status === "error") {
    return <Alert variant="error" message={resource.message} />;
  }

  const { data: candidate } = resource;

  function startEdit(note: CandidateNoteDto) {
    setEditingStageId(note.stageId);
    setDraftBody(note.body ?? "");
  }

  function cancelEdit() {
    setEditingStageId(null);
  }

  async function saveEdit(stageId: number) {
    try {
      await upsertNote.mutate({ stageId, body: draftBody });
      setEditingStageId(null);
      await resource.refetch();
    } catch {
      // upsertNote.error/fieldErrors render the failure below.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">{candidate.fullName}</h1>
        <div className="text-muted-foreground mt-2 flex flex-wrap gap-4 text-sm">
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
          <span className="flex items-center gap-1">
            <User className="size-4" />
            Added {formatDateTime(candidate.addedAt)}
          </span>
        </div>
        <a
          href={`/candidates/${candidate.candidateId}`}
          className="text-primary mt-2 inline-block text-sm hover:underline"
        >
          View full profile &rarr;
        </a>
      </div>

      <div className="flex flex-col gap-3">
        {candidate.notes.map((note) => (
          <NoteCard
            key={note.stageId}
            note={note}
            isCurrentStage={note.stageId === candidate.currentStageId}
            isEditing={editingStageId === note.stageId}
            draftBody={draftBody}
            onDraftChange={setDraftBody}
            onStartEdit={() => {
              startEdit(note);
            }}
            onCancelEdit={cancelEdit}
            onSave={() => {
              void saveEdit(note.stageId);
            }}
            saving={upsertNote.status === "loading"}
            error={editingStageId === note.stageId ? upsertNote.fieldErrors?.body : undefined}
          />
        ))}
      </div>

      {editingStageId !== null && upsertNote.status === "error" && !upsertNote.fieldErrors && (
        <Alert variant="error" message={upsertNote.error} />
      )}
    </div>
  );
}
