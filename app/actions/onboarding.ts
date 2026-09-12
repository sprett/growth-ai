"use server";

import { isGithubConnected, toPublicConnection } from "@/lib/onboarding";
import { verifyPosthogAccess } from "@/lib/posthog/customer";
import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function requireUser() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Not signed in");
  }
  return { supabase, userId: data.user.id };
}

export async function saveGithubInstallation(installationId: string) {
  const id = installationId.trim();
  if (!/^\d+$/.test(id)) {
    return { error: "Installation ID should be a number from the GitHub App URL." };
  }

  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("connections").upsert(
    {
      org_id: userId,
      github_installation_id: id,
    },
    { onConflict: "org_id" },
  );

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/onboarding");
  revalidatePath("/");
  return { ok: true as const };
}

export async function saveGithubRepo(formData: FormData) {
  const repo = String(formData.get("github_repo_full_name") ?? "").trim();
  if (!repo.includes("/")) {
    return { error: "Use owner/repo, like acme/checkout." };
  }

  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("connections").upsert(
    {
      org_id: userId,
      github_repo_full_name: repo,
    },
    { onConflict: "org_id" },
  );

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/onboarding");
  revalidatePath("/");
  return { ok: true as const };
}

export async function savePosthogConnection(formData: FormData) {
  const apiKey = String(formData.get("posthog_api_key") ?? "").trim();
  const projectId = String(formData.get("posthog_project_id") ?? "").trim();
  const host = String(formData.get("posthog_host") ?? "").trim();

  if (!apiKey || !projectId || !host) {
    return { error: "API key, project ID, and host are required." };
  }

  const { supabase, userId } = await requireUser();
  const { data: existing } = await supabase
    .from("connections")
    .select(
      "github_installation_id, github_repo_full_name, posthog_api_key, posthog_project_id, posthog_host",
    )
    .eq("org_id", userId)
    .maybeSingle();

  if (!isGithubConnected(toPublicConnection(existing))) {
    return { error: "Install the GitHub App before connecting PostHog." };
  }

  const verified = await verifyPosthogAccess({ apiKey, projectId, host });
  if (!verified.ok) {
    return { error: verified.error };
  }

  const { error } = await supabase.from("connections").upsert(
    {
      org_id: userId,
      github_installation_id: existing?.github_installation_id ?? null,
      github_repo_full_name: existing?.github_repo_full_name ?? null,
      posthog_api_key: apiKey,
      posthog_project_id: projectId,
      posthog_host: host,
    },
    { onConflict: "org_id" },
  );

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/");
  revalidatePath("/onboarding");
  return { ok: true as const };
}
