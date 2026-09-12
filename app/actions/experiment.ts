"use server";

import { getOrgId } from "@/lib/org";
import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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

  // Fire-and-forget — do not await, returns immediately to the UI
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  fetch(`${siteUrl}/api/pipeline/${experiment.id}`, { method: "POST" }).catch(
    () => {},
  );

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
  variants: ExperimentVariantProgress[];
};

/**
 * Polled by the chat while an experiment's pipeline run
 * (app/api/pipeline/[experimentId]) is in flight — that route runs
 * fire-and-forget with no synchronous result, so this is how the UI
 * observes progress.
 */
export async function getExperimentProgress(
  experimentId: string,
): Promise<{ error: string } | { ok: true; progress: ExperimentProgress }> {
  const supabase = await createServerSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { error: "Not signed in" };
  }

  const { data: experiment, error } = await supabase
    .from("experiments")
    .select("status, current_step, active_hypothesis")
    .eq("id", experimentId)
    .single();

  if (error || !experiment) {
    return { error: error?.message ?? "Experiment not found" };
  }

  const { data: variants } = await supabase
    .from("variants")
    .select("label, element, dimension, value, pr_url, posthog_flag_key")
    .eq("experiment_id", experimentId);

  return {
    ok: true,
    progress: {
      status: experiment.status as string | null,
      currentStep: experiment.current_step as string | null,
      activeHypothesis: experiment.active_hypothesis as Record<string, unknown> | null,
      variants: (variants ?? []) as ExperimentVariantProgress[],
    },
  };
}
