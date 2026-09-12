import { createAdminSupabase } from "@/lib/supabase-admin";
import { runStep } from "@/lib/pipeline/run";
import type { PipelineStepName } from "@/lib/pipeline/types";
import { NextResponse } from "next/server";

const STEPS: PipelineStepName[] = [
  "parse_request",
  "generate_diff",
  "open_pr",
  "create_flag",
  "simulate_traffic",
  "analyze_results",
  "update_playbook",
  "synthesize_next",
];

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ experimentId: string }> },
) {
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

  let activeHypothesis = experiment.active_hypothesis as Record<string, string> | null;

  for (const step of STEPS) {
    await supabase
      .from("experiments")
      .update({ current_step: step, status: "running" })
      .eq("id", experimentId);

    const result = await runStep(step, orgId, experimentId, {
      promptText: experiment.prompt_text as string,
      cycleNumber: (experiment.cycle_number as number) ?? 1,
      activeHypothesis,
    });

    // Re-read hypothesis after parse_request so later steps see the fresh value
    if (step === "parse_request" && result.ok) {
      const { data: fresh } = await supabase
        .from("experiments")
        .select("active_hypothesis")
        .eq("id", experimentId)
        .single();
      activeHypothesis = (fresh?.active_hypothesis as Record<string, string>) ?? activeHypothesis;
    }

    if (!result.ok) {
      await supabase
        .from("experiments")
        .update({ status: "failed", current_step: step })
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
