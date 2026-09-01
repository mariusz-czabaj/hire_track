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
import { useMutation } from "@/components/hooks/useMutation";
import type { ApiErrorBody, CandidateDetailDto, KanbanBoardStageDto, MoveCandidateCommand } from "@/types";

interface MoveCandidateDialogProps {
  recruitmentId: string;
  candidateRecruitmentId: number;
  triggerLabel: string;
  stages: KanbanBoardStageDto[];
  onChanged: () => void;
}

type DetailLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; currentStageId: number }
  | { status: "error"; message: string };

export function MoveCandidateDialog({
  recruitmentId,
  candidateRecruitmentId,
  triggerLabel,
  stages,
  onChanged,
}: MoveCandidateDialogProps) {
  const [open, setOpen] = useState(false);
  const [detailLoad, setDetailLoad] = useState<DetailLoadState>({ status: "idle" });
  const [toStageId, setToStageId] = useState<number | undefined>(undefined);
  const [note, setNote] = useState("");

  const candidateUrl = `/api/recruitments/${encodeURIComponent(recruitmentId)}/candidates/${candidateRecruitmentId}`;
  const moveCandidate = useMutation<MoveCandidateCommand, { id: number; currentStageId: number }>(
    candidateUrl,
    "PATCH",
  );

  async function loadDetail() {
    setDetailLoad({ status: "loading" });
    try {
      const response = await fetch(candidateUrl);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setDetailLoad({ status: "error", message: body?.error.message ?? "Could not load this candidate." });
        return;
      }
      const detail = (await response.json()) as CandidateDetailDto;
      const currentNote = detail.notes.find((n) => n.stageId === detail.currentStageId);
      setToStageId(detail.currentStageId);
      setNote(currentNote?.body ?? "");
      setDetailLoad({ status: "success", currentStageId: detail.currentStageId });
    } catch {
      setDetailLoad({ status: "error", message: "Could not load this candidate." });
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      void loadDetail();
    }
  }

  async function handleMove() {
    if (toStageId === undefined) return;
    try {
      await moveCandidate.mutate({ toStageId, note: note.trim() || undefined });
      onChanged();
      setOpen(false);
    } catch {
      // moveCandidate.error/fieldErrors render the failure below.
    }
  }

  const moving = moveCandidate.status === "loading";
  const loaded = detailLoad.status === "success";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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

        {detailLoad.status === "loading" && <p className="text-sm text-blue-100/70">Loading...</p>}
        {detailLoad.status === "error" && <ServerError message={detailLoad.message} />}

        {loaded && (
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
              message={
                moveCandidate.status === "error" && !moveCandidate.fieldErrors?.note ? moveCandidate.error : null
              }
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
        )}
      </DialogContent>
    </Dialog>
  );
}
