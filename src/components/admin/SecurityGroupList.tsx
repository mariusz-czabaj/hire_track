import { useState } from "react";
import { Plus, Shield } from "lucide-react";
import { useApiResource } from "@/components/hooks/useApiResource";
import { useMutation } from "@/components/hooks/useMutation";
import { ServerError } from "@/components/auth/ServerError";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SecurityGroupDto } from "@/types";

export function SecurityGroupList() {
  const groups = useApiResource<SecurityGroupDto[]>("/api/security-groups");
  const [name, setName] = useState("");
  const { mutate, status, error, fieldErrors } = useMutation<{ name: string }, SecurityGroupDto>(
    "/api/security-groups",
    "POST",
  );

  async function handleCreate(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await mutate({ name });
      setName("");
      await groups.refetch();
    } catch {
      // status/error state from useMutation renders the failure; nothing else to do here.
    }
  }

  const submitting = status === "loading";

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleCreate} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder="New group name"
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:ring-2 focus:ring-purple-400 focus:outline-none"
          />
          {fieldErrors?.name ? <p className="mt-1 text-xs text-red-300">{fieldErrors.name}</p> : null}
        </div>
        <Button
          type="submit"
          disabled={submitting}
          className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
        >
          <span className="flex items-center gap-2">
            <Plus className="size-4" />
            {submitting ? "Creating..." : "Create group"}
          </span>
        </Button>
      </form>

      <ServerError message={status === "error" && !fieldErrors ? error : null} />

      {groups.status === "loading" && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl bg-white/10" />
          ))}
        </div>
      )}

      {groups.status === "success" && groups.data.length === 0 && (
        <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-blue-100/70">
          No security groups yet.
        </p>
      )}

      {groups.status === "success" && groups.data.length > 0 && (
        <div className="flex flex-col gap-3">
          {groups.data.map((group) => (
            <a key={group.id} href={`/admin/groups/${group.id}`} className="block">
              <Card className="flex flex-row items-center gap-3 border-white/10 bg-white/10 p-4 text-white transition-colors hover:bg-white/15">
                <Shield className="size-4 text-purple-300" />
                <span className="font-semibold">{group.name}</span>
              </Card>
            </a>
          ))}
        </div>
      )}

      {groups.status === "error" && <ServerError message={groups.message} />}
    </div>
  );
}
