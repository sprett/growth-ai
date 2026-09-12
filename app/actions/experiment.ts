"use server";

import { getOrgId } from "@/lib/org";
import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function startExperiment(formData: FormData) {
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
  return { ok: true, experimentId: experiment.id as string };
}
