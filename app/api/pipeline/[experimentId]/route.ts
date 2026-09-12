import { createAdminSupabase } from "@/lib/supabase-admin";
import { runStep } from "@/lib/pipeline/run";
import { parseFromStep, shouldPauseAfter, stepsFrom } from "@/lib/pipeline/schedule";
import { pipelineOrigin, triggerPipeline } from "@/lib/pipeline/trigger";
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
  // calls on someone else's org." Fails closed: a missing
  // PIPELINE_INTERNAL_SECRET is a misconfiguration, not "no check needed."
  const expectedSecret = process.env.PIPELINE_INTERNAL_SECRET;
  if (!expectedSecret || req.headers.get("x-pipeline-secret") !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fromStep = parseFromStep(new URL(req.url).searchParams.get("from"));
  if (!fromStep) {
    return NextResponse.json({ error: "Invalid from step" }, { status: 400 });
  }

  const { experimentId } = await params;
  const supabase = createAdminSupabase();

  const { data: experiment, error } = await supabase
    .from("experiments")
    .select("id, org_id, prompt_text, cycle_number, active_hypothesis, status")
    .eq("id", experimentId)
    .single();

  if (error || !experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  // Resume-from-merge is only valid while we're actually waiting on that
  // merge. A second GitHub delivery (or a stray trigger) after the pipeline
  // has already continued must not re-run simulate_traffic / analyze.
  if (fromStep === "create_flag") {
    const { data: claimed } = await supabase
      .from("experiments")
      .update({ status: "running", current_step: fromStep })
      .eq("id", experimentId)
      .eq("status", "pr_open")
      .select("id");
    if (!claimed?.length) {
      return NextResponse.json({ ok: true, skipped: true });
    }
  }

  const orgId = experiment.org_id as string;

  for (const step of stepsFrom(fromStep)) {
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

    // The variant isn't on the customer site until a human merges the PR.
    // Stop here so simulate_traffic (and everything after) can't run against
    // code nobody can actually hit. The GitHub merge webhook resumes from
    // create_flag.
    if (shouldPauseAfter(step)) {
      await supabase
        .from("experiments")
        .update({ status: "pr_open", current_step: step })
        .eq("id", experimentId);
      return NextResponse.json({ ok: true, paused: "pr_open" });
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

      triggerPipeline(pipelineOrigin(req), experimentId, "generate_diff");
      return NextResponse.json({ ok: true, looping: true });
    }
  }

  await supabase
    .from("experiments")
    .update({ status: "done", current_step: null })
    .eq("id", experimentId);

  return NextResponse.json({ ok: true });
}
