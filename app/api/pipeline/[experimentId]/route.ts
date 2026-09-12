import { createAdminSupabase } from "@/lib/supabase-admin";
import { runStep } from "@/lib/pipeline/run";
import { PIPELINE_STEP_ORDER } from "@/lib/pipeline/types";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ experimentId: string }> },
) {
  // This route carries no user session (it's hit by startExperiment's
  // server-to-server fire-and-forget fetch, which has no cookies to send)
  // and is exempted from the auth middleware for that reason — a shared
  // secret is the only thing standing between "internal trigger" and "any
  // caller who knows an experiment id can spend Anthropic/GitHub/PostHog
  // calls on someone else's org."
  const expectedSecret = process.env.PIPELINE_INTERNAL_SECRET;
  if (expectedSecret && req.headers.get("x-pipeline-secret") !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { experimentId } = await params;
  const supabase = createAdminSupabase();

  const { data: experiment, error } = await supabase
    .from("experiments")
    .select("id, org_id, prompt_text, cycle_number, active_hypothesis")
    .eq("id", experimentId)
    .single();

  if (error || !experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  const orgId = experiment.org_id as string;

  for (const step of PIPELINE_STEP_ORDER) {
    await supabase
      .from("experiments")
      .update({ current_step: step, status: "running" })
      .eq("id", experimentId);

    // Re-read active_hypothesis (and cycle_number) before every step: earlier
    // steps in this same loop (parse_request, analyze_results) write it, and
    // the `experiment` object fetched once above the loop would otherwise be
    // stale for every step after the first.
    const { data: freshExperiment } = await supabase
      .from("experiments")
      .select("cycle_number, active_hypothesis")
      .eq("id", experimentId)
      .single();

    const result = await runStep(step, orgId, experimentId, {
      promptText: experiment.prompt_text as string,
      cycleNumber: (freshExperiment?.cycle_number as number | undefined) ?? (experiment.cycle_number as number) ?? 1,
      activeHypothesis:
        (freshExperiment?.active_hypothesis as Record<string, string> | null | undefined) ??
        (experiment.active_hypothesis as Record<string, string> | null),
    });

    if (!result.ok) {
      // Stash the real failure reason inside active_hypothesis (jsonb) rather
      // than adding a migration for a dedicated column — analyzeResults
      // already merges its own `results` key into this same column, so this
      // follows the pattern already established here. The chat reads
      // `activeHypothesis.error_message` to show the actual reason instead
      // of a generic "<step> failed."
      const currentHypothesis =
        (freshExperiment?.active_hypothesis as Record<string, unknown> | null | undefined) ??
        (experiment.active_hypothesis as Record<string, unknown> | null) ??
        {};
      await supabase
        .from("experiments")
        .update({
          status: "failed",
          current_step: step,
          active_hypothesis: { ...currentHypothesis, error_message: result.message },
        })
        .eq("id", experimentId);
      return NextResponse.json({ error: result.message, step }, { status: 500 });
    }

    // After synthesize_next, loop back for cycle 2
    if (step === "synthesize_next" && result.nextHypothesis) {
      const nextCycle = ((experiment.cycle_number as number) ?? 1) + 1;
      await supabase
        .from("experiments")
        .update({
          cycle_number: nextCycle,
          active_hypothesis: result.nextHypothesis,
          current_step: null,
          status: "awaiting_loop",
        })
        .eq("id", experimentId);

      // Kick off cycle 2 automatically
      await fetch(
        `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/pipeline/${experimentId}/loop`,
        { method: "POST" },
      );
      return NextResponse.json({ ok: true, looping: true });
    }
  }

  await supabase
    .from("experiments")
    .update({ status: "done", current_step: null })
    .eq("id", experimentId);

  return NextResponse.json({ ok: true });
}
