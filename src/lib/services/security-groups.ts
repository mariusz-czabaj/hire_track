import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { Operation, SecurityGroupDetailDto, SecurityGroupDto, UserSearchResultDto } from "@/types";

type Client = SupabaseClient<Database>;

export async function listSecurityGroups(client: Client): Promise<SecurityGroupDto[]> {
  const { data, error } = await client.from("security_groups").select("id, name").order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return data;
}

export async function createSecurityGroup(client: Client, name: string): Promise<SecurityGroupDto> {
  const { data, error } = await client.from("security_groups").insert({ name }).select("id, name").single();

  if (error) {
    throw error;
  }

  return data;
}

export async function renameSecurityGroup(client: Client, groupId: number, name: string): Promise<SecurityGroupDto> {
  const { data, error } = await client
    .from("security_groups")
    .update({ name })
    .eq("id", groupId)
    .select("id, name")
    .maybeSingle();

  if (error) {
    throw error;
  }

  // `security_groups` is readable by every authenticated user (RLS), so a
  // zero-row update result never means "the group doesn't exist" -- it
  // means the caller's own group.manage grant was rejected by the update
  // policy. Surface it the same way the RPC-backed writes do.
  if (!data) {
    throw Object.assign(new Error("insufficient_privilege: group.manage required"), { code: "42501" });
  }

  return data;
}

export async function getSecurityGroupDetail(client: Client, groupId: number): Promise<SecurityGroupDetailDto | null> {
  const { data: group, error: groupError } = await client
    .from("security_groups")
    .select("id, name")
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    throw groupError;
  }
  if (!group) {
    return null;
  }

  const { data: operationRows, error: operationsError } = await client
    .from("group_operations")
    .select("operation")
    .eq("group_id", groupId);

  if (operationsError) {
    throw operationsError;
  }

  const { data: memberRows, error: membersError } = await client.rpc("get_group_member_emails", {
    target_group_id: groupId,
  });

  if (membersError) {
    throw membersError;
  }

  return {
    id: group.id,
    name: group.name,
    operations: operationRows.map((row) => row.operation),
    members: memberRows.map((row) => ({ userId: row.id, email: row.email })),
  };
}

export async function grantGroupOperation(client: Client, groupId: number, operation: Operation): Promise<Operation[]> {
  const { error } = await client.from("group_operations").insert({ group_id: groupId, operation });

  if (error) {
    throw error;
  }

  return listGroupOperations(client, groupId);
}

export async function revokeGroupOperation(
  client: Client,
  groupId: number,
  operation: Operation,
): Promise<Operation[]> {
  const { error } = await client.rpc("revoke_group_operation", {
    target_group_id: groupId,
    target_operation: operation,
  });

  if (error) {
    throw error;
  }

  return listGroupOperations(client, groupId);
}

async function listGroupOperations(client: Client, groupId: number): Promise<Operation[]> {
  const { data, error } = await client.from("group_operations").select("operation").eq("group_id", groupId);

  if (error) {
    throw error;
  }

  return data.map((row) => row.operation);
}

export async function addGroupMember(
  client: Client,
  groupId: number,
  userId: string,
): Promise<SecurityGroupDetailDto["members"]> {
  const { error } = await client.from("group_memberships").insert({ group_id: groupId, user_id: userId });

  if (error) {
    throw error;
  }

  return listGroupMembers(client, groupId);
}

export async function removeGroupMember(
  client: Client,
  groupId: number,
  userId: string,
): Promise<SecurityGroupDetailDto["members"]> {
  const { error } = await client.rpc("remove_group_member", {
    target_group_id: groupId,
    target_user_id: userId,
  });

  if (error) {
    throw error;
  }

  return listGroupMembers(client, groupId);
}

async function listGroupMembers(client: Client, groupId: number): Promise<SecurityGroupDetailDto["members"]> {
  const { data, error } = await client.rpc("get_group_member_emails", { target_group_id: groupId });

  if (error) {
    throw error;
  }

  return data.map((row) => ({ userId: row.id, email: row.email }));
}

export async function searchUsers(client: Client, searchTerm: string): Promise<UserSearchResultDto[]> {
  const { data, error } = await client.rpc("search_users_for_group_management", { search_term: searchTerm });

  if (error) {
    throw error;
  }

  return data.map((row) => ({ id: row.id, email: row.email }));
}
