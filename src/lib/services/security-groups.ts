import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { SecurityGroupDto } from "@/types";

type Client = SupabaseClient<Database>;

export async function listSecurityGroups(client: Client): Promise<SecurityGroupDto[]> {
  const { data, error } = await client.from("security_groups").select("id, name").order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return data;
}
