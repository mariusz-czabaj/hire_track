import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useApiResource } from "@/components/hooks/useApiResource";
import { useMutation } from "@/components/hooks/useMutation";
import type { CandidateDetailDto, KanbanBoardStageDto, MoveCandidateCommand } from "@/types";

interface MoveCandidateDialogProps {
  recruitmentId: string;
  candidateRecruitmentId: number;
  triggerLabel: string;
  stages: KanbanBoardStageDto[];
  onChanged: () => void;
}

interface MoveCandidateFormProps {
  candidateUrl: string;
  stages: KanbanBoardStageDto[];
  onMoved: () => void;
}

// Only mounted while the dialog is open, so useApiResource's mount-time
// fetch happens on open rather than once per board card on page load.
function MoveCandidateForm({ candidateUrl, stages, onMoved }: MoveCandidateFormProps) {
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
    setToStageId(detail.currentStageId);
    setNote(detail.notes.find((n) => n.stageId === detail.currentStageId)?.body ?? "");
  }

  const moveCandidate = useMutation<MoveCandidateCommand, { id: number; currentStageId: number }>(
    candidateUrl,
    "PATCH",
  );

  async function handleMove() {
    if (toStageId === undefined) return;
    try {
      await moveCandidate.mutate({ toStageId, note: note.trim() || undefined });
      onMoved();
    } catch {
      // moveCandidate.error/fieldErrors render the failure below.
    }
  }

  const moving = moveCandidate.status === "loading";

  if (resource.status === "loading") {
    return <p className="text-sm text-blue-100/70">Loading...</p>;
  }

  if (resource.status === "not-found" || resource.status === "error") {
    const message = resource.status === "error" ? resource.message : "Could not load this candidate.";
    return <ServerError message={message} />;
  }

  return (
    <>
      <div>
        <label htmlFor="move-candidate-target-stage" className="mb-1 block text-sm text-blue-100/80">
          Target stage
        </label>
        <select
          id="move-candidate-target-stage"
          value={toStageId}
          onChange={(e) => {
            setToStageId(Number(e.target.value));
          }}
          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white focus:ring-2 focus:ring-purple-400 focus:outline-none"
        >
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id} className="bg-slate-900">
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

      <ServerError
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
}: MoveCandidateDialogProps) {
  const [open, setOpen] = useState(false);

  const candidateUrl = `/api/recruitments/${encodeURIComponent(recruitmentId)}/candidates/${candidateRecruitmentId}`;

  function handleMoved() {
    onChanged();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label={triggerLabel}>
          <ArrowRightLeft className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="move-candidate-dialog">
        <DialogHeader>
          <DialogTitle>Move candidate</DialogTitle>
          <DialogDescription>
            Moving out of a stage requires a note for that stage -- add or edit it below.
          </DialogDescription>
        </DialogHeader>

        {open && <MoveCandidateForm candidateUrl={candidateUrl} stages={stages} onMoved={handleMoved} />}
      </DialogContent>
    </Dialog>
  );
}
