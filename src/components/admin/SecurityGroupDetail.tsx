import { useState } from "react";
import { Check, Save, Trash2 } from "lucide-react";
import { useApiResource } from "@/components/hooks/useApiResource";
import { ServerError } from "@/components/auth/ServerError";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UserSearchPicker } from "@/components/admin/UserSearchPicker";
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
    return body.error.message || "Something went wrong. Please try again.";
  } catch {
    return "Something went wrong. Please try again.";
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
  const [pendingOperation, setPendingOperation] = useState<Operation | null>(null);
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
    } catch {
      setRenameError("Something went wrong. Please try again.");
    } finally {
      setRenaming(false);
    }
  }

  async function handleToggleOperation(operation: Operation, checked: boolean) {
    const previous = operations;
    setPendingOperation(operation);
    setOperationError(null);
    setOperations(checked ? [...previous, operation] : previous.filter((op) => op !== operation));

    try {
      const response = await fetch(`/api/security-groups/${groupId}/operations`, {
        method: checked ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation }),
      });
      if (!response.ok) {
        setOperations(previous);
        setOperationError(await readErrorMessage(response));
        return;
      }
      const body = (await response.json()) as { operations: Operation[] };
      setOperations(body.operations);
    } catch {
      setOperations(previous);
      setOperationError("Something went wrong. Please try again.");
    } finally {
      setPendingOperation(null);
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
    } catch {
      setMemberError("Something went wrong. Please try again.");
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
    } catch {
      setMemberError("Something went wrong. Please try again.");
    } finally {
      setPendingMemberId(null);
    }
  }

  if (resource.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-full rounded-xl bg-white/10" />
        <Skeleton className="h-40 w-full rounded-xl bg-white/10" />
        <Skeleton className="h-40 w-full rounded-xl bg-white/10" />
      </div>
    );
  }

  if (resource.status === "not-found") {
    return <ServerError message="Security group could not be found." />;
  }

  if (resource.status === "error") {
    return <ServerError message={resource.message} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleRename} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white focus:ring-2 focus:ring-purple-400 focus:outline-none"
          />
        </div>
        <Button
          type="submit"
          disabled={renaming}
          className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
        >
          <span className="flex items-center gap-2">
            <Save className="size-4" />
            {renaming ? "Saving..." : "Rename"}
          </span>
        </Button>
      </form>
      <ServerError message={renameError} />

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Operations</h2>
        <div className="flex flex-col gap-2">
          {operationSchema.options.map((operation) => (
            <label key={operation} className="flex items-center gap-2 text-sm text-blue-100/80">
              <input
                type="checkbox"
                checked={operations.includes(operation)}
                disabled={pendingOperation === operation}
                onChange={(e) => {
                  void handleToggleOperation(operation, e.target.checked);
                }}
                className="size-4 rounded border-white/30 bg-white/10"
              />
              {OPERATION_LABELS[operation]}
            </label>
          ))}
        </div>
        <ServerError message={operationError} />
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Members</h2>
        {members.length === 0 ? (
          <p className="text-sm text-blue-100/50">No members yet.</p>
        ) : (
          <ul className="mb-4 flex flex-col gap-1">
            {members.map((member) => (
              <li
                key={member.userId}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white"
              >
                <span className="flex items-center gap-2">
                  <Check className="size-3.5 text-green-300" />
                  {member.email}
                </span>
                <button
                  type="button"
                  disabled={pendingMemberId === member.userId}
                  onClick={() => {
                    void handleRemoveMember(member.userId);
                  }}
                  className="flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-xs transition-colors hover:bg-white/20 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <ServerError message={memberError} />
        <UserSearchPicker existingUserIds={members.map((m) => m.userId)} onAdd={handleAddMember} />
      </section>
    </div>
  );
}
