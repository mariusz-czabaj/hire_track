import { useEffect, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useApiResource } from "@/components/hooks/useApiResource";
import { useMutation } from "@/components/hooks/useMutation";
import { focusFirstInvalidField } from "@/components/hooks/useFormErrors";
import { toast } from "@/lib/toast-store";
import type { CandidateDetailDto, KanbanBoardStageDto, MoveCandidateCommand } from "@/types";

interface MoveCandidateDialogProps {
  recruitmentId: string;
  candidateRecruitmentId: number;
  triggerLabel: string;
  stages: KanbanBoardStageDto[];
  onChanged: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialStageId?: number;
}

interface MoveCandidateFormProps {
  candidateUrl: string;
  stages: KanbanBoardStageDto[];
  initialStageId?: number;
  onMoved: () => void;
}

// Only mounted while the dialog is open, so useApiResource's mount-time
// fetch happens on open rather than once per board card on page load.
function MoveCandidateForm({ candidateUrl, stages, initialStageId, onMoved }: MoveCandidateFormProps) {
  const resource = useApiResource<CandidateDetailDto>(candidateUrl);
  const detail = resource.status === "success" ? resource.data : undefined;

  // Seed the form once the detail resolves. Adjusted during render (React's
  // recommended pattern for deriving state from a prop-like value) rather
  // than in an effect, since `detail` only ever changes once per mount here.
  const [seededDetail, setSeededDetail] = useState<CandidateDetailDto | undefined>(undefined);
  const [toStageId, setToStageId] = useState<number | undefined>(undefined);
  const [note, setNote] = useState("");

  if (detail && detail !== seededDetail) {
    setSeededDetail(detail);
    setToStageId(initialStageId ?? detail.currentStageId);
    setNote(detail.notes.find((n) => n.stageId === detail.currentStageId)?.body ?? "");
  }

  const moveCandidate = useMutation<MoveCandidateCommand, { id: number; currentStageId: number }>(
    candidateUrl,
    "PATCH",
  );

  useEffect(() => {
    if (moveCandidate.fieldErrors?.note) {
      focusFirstInvalidField(moveCandidate.fieldErrors, [{ key: "note", id: "move-candidate-note" }]);
    }
  }, [moveCandidate.fieldErrors]);

  async function handleMove() {
    if (toStageId === undefined) return;
    try {
      await moveCandidate.mutate({ toStageId, note: note.trim() || undefined });
      toast({ variant: "success", message: "Candidate moved." });
      onMoved();
    } catch {
      // moveCandidate.error/fieldErrors render the failure below.
    }
  }

  const moving = moveCandidate.status === "loading";

  if (resource.status === "loading") {
    return <p className="text-muted-foreground text-sm">Loading...</p>;
  }

  if (resource.status === "not-found") {
    return <Alert variant="info" message="Could not load this candidate." />;
  }

  if (resource.status === "error") {
    return <Alert variant="error" message={resource.message} />;
  }

  return (
    <>
      <div>
        <label htmlFor="move-candidate-target-stage" className="text-muted-foreground mb-1 block text-sm">
          Target stage
        </label>
        <select
          id="move-candidate-target-stage"
          value={toStageId}
          onChange={(e) => {
            setToStageId(Number(e.target.value));
          }}
          className="border-input bg-input/30 text-foreground focus:ring-ring w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
        >
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id} className="bg-popover text-popover-foreground">
              {stage.name}
            </option>
          ))}
        </select>
      </div>

      <Textarea
        id="move-candidate-note"
        label="Note for the stage being left"
        value={note}
        onChange={setNote}
        error={moveCandidate.fieldErrors?.note}
        placeholder="What happened at this stage?"
      />

      <Alert
        variant="error"
        message={moveCandidate.status === "error" && !moveCandidate.fieldErrors?.note ? moveCandidate.error : null}
      />

      <DialogFooter>
        <Button
          type="button"
          disabled={moving}
          onClick={() => {
            void handleMove();
          }}
        >
          {moving ? "Moving..." : "Move"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function MoveCandidateDialog({
  recruitmentId,
  candidateRecruitmentId,
  triggerLabel,
  stages,
  onChanged,
  open,
  onOpenChange,
  initialStageId,
}: MoveCandidateDialogProps) {
  const candidateUrl = `/api/recruitments/${encodeURIComponent(recruitmentId)}/candidates/${candidateRecruitmentId}`;

  function handleMoved() {
    onChanged();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={triggerLabel}
        onClick={() => {
          onOpenChange(true);
        }}
      >
        <ArrowRightLeft className="size-4" />
      </Button>
      <DialogContent data-testid="move-candidate-dialog">
        <DialogHeader>
          <DialogTitle>Move candidate</DialogTitle>
          <DialogDescription>
            Moving out of a stage requires a note for that stage -- add or edit it below.
          </DialogDescription>
        </DialogHeader>

        {open && (
          <MoveCandidateForm
            candidateUrl={candidateUrl}
            stages={stages}
            initialStageId={initialStageId}
            onMoved={handleMoved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
