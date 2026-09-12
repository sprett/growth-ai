"use server";

import { getOrgId } from "@/lib/org";
import { createAdminSupabase } from "@/lib/supabase-admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function requireUser() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Not signed in");
  }
  return { supabase, user: data.user };
}

export async function createInvite() {
  const { supabase, user } = await requireUser();
  const orgId = await getOrgId(supabase, user);

  const { data, error } = await supabase
    .from("invites")
    .insert({ org_id: orgId, invited_by: user.id })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Could not create invite" };
  }

  revalidatePath("/");
  return { ok: true as const, token: data.id as string };
}

export type InvitePreview = { status: "valid" } | { status: "invalid" };

/** Uses the admin client since a visitor may not be signed in yet. */
export async function getInvitePreview(token: string): Promise<InvitePreview> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("invites")
    .select("accepted_at")
    .eq("id", token)
    .maybeSingle();

  if (!data || data.accepted_at) {
    return { status: "invalid" };
  }

  return { status: "valid" };
}

export async function acceptInvite(token: string) {
  const { supabase } = await requireUser();

  const { error } = await supabase.rpc("accept_invite", { invite_id: token });

  if (error) {
    if (error.message.includes("already_member")) {
      return { error: "You're already part of an organization." };
    }
    if (error.message.includes("invalid_invite")) {
      return { error: "This invite link is no longer valid." };
    }
    return { error: error.message };
  }

  revalidatePath("/");
  return { ok: true as const };
}
