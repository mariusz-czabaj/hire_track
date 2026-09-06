import { useState } from "react";
import { Plus, Shield } from "lucide-react";
import { useApiResource } from "@/components/hooks/useApiResource";
import { useMutation } from "@/components/hooks/useMutation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
          <Input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder="New group name"
          />
          {fieldErrors?.name ? <Alert variant="error" message={fieldErrors.name} className="mt-1" /> : null}
        </div>
        <Button type="submit" disabled={submitting} className="shrink-0">
          <span className="flex items-center gap-2">
            <Plus className="size-4" />
            {submitting ? "Creating..." : "Create group"}
          </span>
        </Button>
      </form>

      <Alert variant="error" message={status === "error" && !fieldErrors ? error : null} />

      {groups.status === "loading" && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      )}

      {groups.status === "success" && groups.data.length === 0 && (
        <p className="border-border bg-muted text-muted-foreground rounded-xl border px-4 py-6 text-center">
          No security groups yet.
        </p>
      )}

      {groups.status === "success" && groups.data.length > 0 && (
        <div className="flex flex-col gap-3">
          {groups.data.map((group) => (
            <a key={group.id} href={`/admin/groups/${group.id}`} className="block">
              <Card className="hover:bg-accent relative flex flex-row items-center gap-3 overflow-hidden border-0 p-4 pl-6 shadow-md transition-colors">
                <div className="bg-primary absolute inset-y-0 left-0 w-1.5" aria-hidden="true" />
                <Shield className="text-primary size-4" />
                <span className="font-semibold">{group.name}</span>
              </Card>
            </a>
          ))}
        </div>
      )}

      {groups.status === "error" && <Alert variant="error" message={groups.message} />}
    </div>
  );
}
