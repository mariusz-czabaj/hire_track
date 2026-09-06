import { useState } from "react";
import { Check, Save, Trash2 } from "lucide-react";
import { useApiResource } from "@/components/hooks/useApiResource";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UserSearchPicker } from "@/components/admin/UserSearchPicker";
import { toast } from "@/lib/toast-store";
import { DEFAULT_ERROR_MESSAGE } from "@/components/hooks/useMutation";
import { operationSchema, type Operation, type SecurityGroupDetailDto, type UserSearchResultDto } from "@/types";

interface SecurityGroupDetailProps {
  groupId: string;
}

const OPERATION_LABELS: Record<Operation, string> = {
  "recruitment.read": "View recruitments",
  "recruitment.write": "Manage recruitments",
  "candidate.read": "View candidates",
  "candidate.write": "Manage candidates",
  "group.manage": "Manage security groups",
};

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error: { message: string } };
    return body.error.message || DEFAULT_ERROR_MESSAGE;
  } catch {
    return DEFAULT_ERROR_MESSAGE;
  }
}

export function SecurityGroupDetail({ groupId }: SecurityGroupDetailProps) {
  const resource = useApiResource<SecurityGroupDetailDto>(`/api/security-groups/${groupId}`);

  const loadedData = resource.status === "success" ? resource.data : null;
  const [syncedData, setSyncedData] = useState<SecurityGroupDetailDto | null>(null);
  const [name, setName] = useState("");
  const [operations, setOperations] = useState<Operation[]>([]);
  const [members, setMembers] = useState<SecurityGroupDetailDto["members"]>([]);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [pendingOperations, setPendingOperations] = useState<ReadonlySet<Operation>>(new Set());
  const [operationError, setOperationError] = useState<string | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);

  if (loadedData && loadedData !== syncedData) {
    setSyncedData(loadedData);
    setName(loadedData.name);
    setOperations(loadedData.operations);
    setMembers(loadedData.members);
  }

  async function handleRename(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setRenaming(true);
    setRenameError(null);
    try {
      const response = await fetch(`/api/security-groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        setRenameError(await readErrorMessage(response));
        return;
      }
      const updated = (await response.json()) as { name: string };
      setName(updated.name);
      toast({ variant: "success", message: "Security group renamed." });
    } catch {
      setRenameError(DEFAULT_ERROR_MESSAGE);
    } finally {
      setRenaming(false);
    }
  }

  async function handleToggleOperation(operation: Operation, checked: boolean) {
    // Functional updates throughout: two checkboxes can be in flight at once,
    // so neither the optimistic apply nor the revert may close over the
    // render-scoped `operations` value -- the second settler would otherwise
    // undo the first's successful change.
    const applyToggle = (list: Operation[], on: boolean) =>
      on ? (list.includes(operation) ? list : [...list, operation]) : list.filter((op) => op !== operation);

    setPendingOperations((prev) => new Set(prev).add(operation));
    setOperationError(null);
    setOperations((prev) => applyToggle(prev, checked));

    const revert = () => {
      setOperations((prev) => applyToggle(prev, !checked));
    };

    try {
      const response = await fetch(`/api/security-groups/${groupId}/operations`, {
        method: checked ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation }),
      });
      if (!response.ok) {
        revert();
        setOperationError(await readErrorMessage(response));
        return;
      }
      const body = (await response.json()) as { operations: Operation[] };
      setOperations(body.operations);
      toast({ variant: "success", message: "Operations updated." });
    } catch {
      revert();
      setOperationError(DEFAULT_ERROR_MESSAGE);
    } finally {
      setPendingOperations((prev) => {
        const next = new Set(prev);
        next.delete(operation);
        return next;
      });
    }
  }

  async function handleAddMember(user: UserSearchResultDto) {
    setMemberError(null);
    try {
      const response = await fetch(`/api/security-groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!response.ok) {
        setMemberError(await readErrorMessage(response));
        return;
      }
      const body = (await response.json()) as { members: SecurityGroupDetailDto["members"] };
      setMembers(body.members);
      toast({ variant: "success", message: "Member added." });
    } catch {
      setMemberError(DEFAULT_ERROR_MESSAGE);
    }
  }

  async function handleRemoveMember(userId: string) {
    setPendingMemberId(userId);
    setMemberError(null);
    try {
      const response = await fetch(`/api/security-groups/${groupId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) {
        setMemberError(await readErrorMessage(response));
        return;
      }
      const body = (await response.json()) as { members: SecurityGroupDetailDto["members"] };
      setMembers(body.members);
      toast({ variant: "success", message: "Member removed." });
    } catch {
      setMemberError(DEFAULT_ERROR_MESSAGE);
    } finally {
      setPendingMemberId(null);
    }
  }

  if (resource.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (resource.status === "not-found") {
    return <Alert variant="info" message="Security group could not be found." />;
  }

  if (resource.status === "error") {
    return <Alert variant="error" message={resource.message} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleRename} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <label htmlFor="security-group-name" className="sr-only">
            Security group name
          </label>
          <input
            id="security-group-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            className="border-input bg-input/30 text-foreground focus:ring-ring w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
          />
        </div>
        <Button type="submit" disabled={renaming} className="shrink-0">
          <span className="flex items-center gap-2">
            <Save className="size-4" />
            {renaming ? "Saving..." : "Rename"}
          </span>
        </Button>
      </form>
      <Alert variant="error" message={renameError} />

      <section className="border-border bg-card rounded-xl border p-4">
        <h2 className="text-foreground mb-3 text-lg font-semibold">Operations</h2>
        <div className="flex flex-col gap-2">
          {operationSchema.options.map((operation) => (
            <label key={operation} className="text-muted-foreground flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={operations.includes(operation)}
                disabled={pendingOperations.has(operation)}
                onChange={(e) => {
                  void handleToggleOperation(operation, e.target.checked);
                }}
                className="border-input bg-input/30 size-4 rounded"
              />
              {OPERATION_LABELS[operation]}
            </label>
          ))}
        </div>
        <Alert variant="error" message={operationError} />
      </section>

      <section className="border-border bg-card rounded-xl border p-4">
        <h2 className="text-foreground mb-3 text-lg font-semibold">Members</h2>
        {members.length === 0 ? (
          <p className="text-muted-foreground text-sm">No members yet.</p>
        ) : (
          <ul className="mb-4 flex flex-col gap-1">
            {members.map((member) => (
              <li
                key={member.userId}
                className="border-border bg-muted text-foreground flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <Check className="text-primary size-3.5" />
                  {member.email}
                </span>
                <button
                  type="button"
                  disabled={pendingMemberId === member.userId}
                  onClick={() => {
                    void handleRemoveMember(member.userId);
                  }}
                  className="border-input bg-input/30 hover:bg-accent flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <Alert variant="error" message={memberError} />
        <UserSearchPicker existingUserIds={members.map((m) => m.userId)} onAdd={handleAddMember} />
      </section>
    </div>
  );
}
