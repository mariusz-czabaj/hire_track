import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ListOrdered, Plus, Settings, Trash2 } from "lucide-react";
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
import type { KanbanBoardStageDto, RecruitmentStagesDto } from "@/types";

interface StageEditorProps {
  recruitmentId: string;
  stages: KanbanBoardStageDto[];
  stagesSource: "default" | "custom";
  onChanged: () => void;
}

interface StageRowState {
  localId: number;
  name: string;
}

export function StageEditor({ recruitmentId, stages, stagesSource, onChanged }: StageEditorProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<StageRowState[]>([]);
  const [localErrors, setLocalErrors] = useState<Record<number, string>>({});
  const nextLocalId = useRef(0);

  // The editor is UX-only read-only guidance -- the server-side
  // candidates-exist gate on replace/reset RPCs is the authoritative
  // enforcement (see plan.md's "Critical Implementation Details").
  const hasCandidates = stages.some((stage) => stage.candidateCount > 0);

  const replaceStages = useMutation<{ stages: { name: string }[] }, RecruitmentStagesDto>(
    `/api/recruitments/${encodeURIComponent(recruitmentId)}/stages`,
    "PUT",
  );
  const resetStages = useMutation<undefined, RecruitmentStagesDto>(
    `/api/recruitments/${encodeURIComponent(recruitmentId)}/stages`,
    "DELETE",
  );

  function handleOpenChange(next: boolean) {
    if (next) {
      setRows(stages.map((stage) => ({ localId: nextLocalId.current++, name: stage.name })));
      setLocalErrors({});
    }
    setOpen(next);
  }

  function addRow() {
    setRows((prev) => [...prev, { localId: nextLocalId.current++, name: "" }]);
  }

  function removeRow(localId: number) {
    setRows((prev) => prev.filter((row) => row.localId !== localId));
  }

  function moveRow(index: number, direction: -1 | 1) {
    setRows((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function updateName(localId: number, name: string) {
    setRows((prev) => prev.map((row) => (row.localId === localId ? { ...row, name } : row)));
  }

  function clearLocalError(index: number) {
    setLocalErrors((prev) => {
      if (!(index in prev)) return prev;
      return Object.fromEntries(Object.entries(prev).filter(([key]) => Number(key) !== index));
    });
  }

  function fieldErrorForRow(index: number): string | undefined {
    return localErrors[index] ?? replaceStages.fieldErrors?.[`stages.${index}.name`];
  }

  function validateRows(): boolean {
    const errors: Record<number, string> = {};
    rows.forEach((row, index) => {
      if (!row.name.trim()) errors[index] = "Stage name is required";
    });
    setLocalErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSave() {
    if (!validateRows()) return;
    try {
      await replaceStages.mutate({ stages: rows.map((row) => ({ name: row.name })) });
      onChanged();
      setOpen(false);
    } catch {
      // replaceStages.error/fieldErrors render the failure below.
    }
  }

  async function handleReset() {
    try {
      await resetStages.mutate(undefined);
      onChanged();
      setOpen(false);
    } catch {
      // resetStages.error renders the failure below.
    }
  }

  const saving = replaceStages.status === "loading";
  const resetting = resetStages.status === "loading";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="gap-2 border-white/10 bg-white/5 text-blue-100/80 hover:bg-white/10"
          data-testid="stage-editor-trigger"
        >
          <Settings className="size-4" />
          Edit stages
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="stage-editor-dialog">
        <DialogHeader>
          <DialogTitle>Edit kanban stages</DialogTitle>
          <DialogDescription>
            {stagesSource === "custom"
              ? "This recruitment uses a custom stage set."
              : "This recruitment inherits the global default stages."}
          </DialogDescription>
        </DialogHeader>

        {hasCandidates ? (
          <p className="text-sm text-blue-100/70" data-testid="stages-locked-message">
            This recruitment already has candidates, so its stages can no longer be changed.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {rows.map((row, index) => (
                <div key={row.localId} className="flex items-end gap-2">
                  <div className="flex-1">
                    <FormField
                      id={`stage-${row.localId}-name`}
                      label={`Stage ${index + 1} name`}
                      value={row.name}
                      onChange={(value) => {
                        updateName(row.localId, value);
                        clearLocalError(index);
                      }}
                      error={fieldErrorForRow(index)}
                      icon={<ListOrdered className="size-4" />}
                    />
                  </div>
                  <div className="flex gap-1 pb-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={index === 0}
                      onClick={() => {
                        moveRow(index, -1);
                      }}
                      aria-label={`Move stage ${index + 1} up`}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={index === rows.length - 1}
                      onClick={() => {
                        moveRow(index, 1);
                      }}
                      aria-label={`Move stage ${index + 1} down`}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={rows.length <= 1}
                      onClick={() => {
                        removeRow(row.localId);
                      }}
                      aria-label={`Remove stage ${index + 1}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <Button type="button" variant="outline" className="gap-2 self-start" onClick={addRow}>
              <Plus className="size-4" />
              Add stage
            </Button>

            <ServerError message={replaceStages.status === "error" ? replaceStages.error : null} />
            <ServerError message={resetStages.status === "error" ? resetStages.error : null} />

            <DialogFooter className="gap-2 sm:justify-between">
              {stagesSource === "custom" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving || resetting}
                  onClick={() => {
                    void handleReset();
                  }}
                >
                  Reset to defaults
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="button"
                disabled={saving || resetting}
                onClick={() => {
                  void handleSave();
                }}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
