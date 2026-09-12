import type { SupabaseClient, User } from "@supabase/supabase-js";

export type Teammate = {
  user_id: string;
  role: string;
  github_login: string | null;
  avatar_url: string | null;
  created_at: string;
};

type MinimalUser = Pick<User, "id" | "user_metadata">;

function profileFields(user: MinimalUser) {
  const meta = user.user_metadata ?? {};
  return {
    github_login:
      (meta.user_name as string | undefined) ??
      (meta.preferred_username as string | undefined) ??
      null,
    avatar_url: (meta.avatar_url as string | undefined) ?? null,
  };
}

/**
 * Resolves the org a user belongs to, bootstrapping a membership row (org_id
 * = their own id) on first login. Existing connections/experiments rows are
 * already keyed by org_id = the founding user's id, so this needs no backfill.
 */
export async function getOrgId(
  supabase: SupabaseClient,
  user: MinimalUser,
): Promise<string> {
  const { data: existing } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing?.org_id) {
    return existing.org_id as string;
  }

  const { data: inserted, error } = await supabase
    .from("memberships")
    .insert({
      user_id: user.id,
      org_id: user.id,
      role: "owner",
      ...profileFields(user),
    })
    .select("org_id")
    .single();

  if (!error && inserted) {
    return inserted.org_id as string;
  }

  // Lost a race with a concurrent bootstrap insert (e.g. two tabs) - re-read.
  const { data: retried } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (retried?.org_id) {
    return retried.org_id as string;
  }

  throw new Error(error?.message ?? "Could not resolve organization");
}

export async function listTeammates(
  supabase: SupabaseClient,
): Promise<Teammate[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, github_login, avatar_url, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Teammate[];
}
