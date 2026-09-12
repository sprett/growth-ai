"use server";

import { getOrgId } from "@/lib/org";
import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

/**
 * Derives the origin to call our own /api/pipeline route on, from the
 * incoming request's own Host header rather than a hardcoded env default —
 * NEXT_PUBLIC_SITE_URL (or the "http://localhost:3000" fallback) silently
 * points at the wrong port whenever the dev server actually runs on a
 * different one (e.g. 3000 already in use), and the fire-and-forget fetch
 * below fails silently against a dead endpoint with no visible error.
 */
async function resolveSiteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  const headerList = await headers();
  const host = headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

export async function startExperiment(
  formData: FormData,
): Promise<{ error: string } | { ok: true; experimentId: string }> {
  const prompt = String(formData.get("prompt") ?? "").trim();
  const imageCount = Number(formData.get("image_count") ?? 0);

  if (!prompt) {
    return { error: "Say what you want to try." };
  }

  const supabase = await createServerSupabase();
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) {
    return { error: "Not signed in" };
  }

  const name =
    prompt.length > 72 ? `${prompt.slice(0, 69).trimEnd()}…` : prompt;

  const orgId = await getOrgId(supabase, data.user);

  const { data: experiment, error } = await supabase
    .from("experiments")
    .insert({
      org_id: orgId,
      name,
      prompt_text: prompt,
      status: "parsing",
      cycle_number: 1,
      image_paths: imageCount > 0 ? [`${imageCount} attached`] : [],
    })
    .select("id")
    .single();

  if (error || !experiment) {
    return { error: error?.message ?? "Could not start experiment" };
  }

  revalidatePath("/");

  // Fire-and-forget — do not await, returns immediately to the UI. Carries no
  // user cookies (server-to-server), so the route is authorized by a shared
  // secret instead of a session — see PIPELINE_INTERNAL_SECRET.
  const siteUrl = await resolveSiteOrigin();
  const internalSecret = process.env.PIPELINE_INTERNAL_SECRET;
  fetch(`${siteUrl}/api/pipeline/${experiment.id}`, {
    method: "POST",
    headers: internalSecret ? { "x-pipeline-secret": internalSecret } : undefined,
  }).catch(() => {});

  return { ok: true, experimentId: experiment.id as string };
}

export type ExperimentVariantProgress = {
  label: string;
  element: string | null;
  dimension: string | null;
  value: string | null;
  pr_url: string | null;
  posthog_flag_key: string | null;
};

export type ExperimentProgress = {
  status: string | null;
  currentStep: string | null;
  activeHypothesis: Record<string, unknown> | null;
  errorMessage: string | null;
  variants: ExperimentVariantProgress[];
};

/**
 * Polled by the chat while an experiment's pipeline run
 * (app/api/pipeline/[experimentId]) is in flight — that route runs
 * fire-and-forget with no synchronous result, so this is how the UI
 * observes progress.
 *
 * Scoped to the caller's own org: `experiments`/`variants` have no RLS
 * policies of their own (only `memberships`/`invites` do), so this
 * server-side org_id filter is the only thing stopping one org from
 * reading another org's experiment by guessing/enumerating its id.
 */
export async function getExperimentProgress(
  experimentId: string,
): Promise<{ error: string } | { ok: true; progress: ExperimentProgress }> {
  const supabase = await createServerSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { error: "Not signed in" };
  }
  const orgId = await getOrgId(supabase, userData.user);

  const { data: experiment, error } = await supabase
    .from("experiments")
    .select("status, current_step, active_hypothesis")
    .eq("id", experimentId)
    .eq("org_id", orgId)
    .single();

  if (error || !experiment) {
    return { error: error?.message ?? "Experiment not found" };
  }

  const { data: variants } = await supabase
    .from("variants")
    .select("label, element, dimension, value, pr_url, posthog_flag_key")
    .eq("experiment_id", experimentId)
    .eq("org_id", orgId);

  const activeHypothesis = experiment.active_hypothesis as Record<string, unknown> | null;
  const errorMessage =
    typeof activeHypothesis?.error_message === "string" ? activeHypothesis.error_message : null;

  return {
    ok: true,
    progress: {
      status: experiment.status as string | null,
      currentStep: experiment.current_step as string | null,
      activeHypothesis,
      errorMessage,
      variants: (variants ?? []) as ExperimentVariantProgress[],
    },
  };
}
