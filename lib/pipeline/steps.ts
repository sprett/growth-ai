import {
  assertGithubTarget,
  assertPosthogTarget,
  getActiveConnection,
} from "@/lib/pipeline/connection";
import type { PipelineStepName, StepResult } from "@/lib/pipeline/types";

async function stub(
  orgId: string,
  step: PipelineStepName,
  message: string,
): Promise<StepResult> {
  await getActiveConnection(orgId);
  return { step, ok: true, message };
}

export async function parseRequest(orgId: string): Promise<StepResult> {
  return stub(
    orgId,
    "parse_request",
    "Would parse the prompt into {element, dimension, variant_value}.",
  );
}

export async function generateDiff(orgId: string): Promise<StepResult> {
  const connection = await getActiveConnection(orgId);
  const repo = assertGithubTarget(connection);
  return {
    step: "generate_diff",
    ok: true,
    message: `Would generate a constrained diff against ${repo}.`,
  };
}

export async function openPr(orgId: string): Promise<StepResult> {
  const connection = await getActiveConnection(orgId);
  const repo = assertGithubTarget(connection);
  return {
    step: "open_pr",
    ok: true,
    message: `Would open a PR on ${repo} via the GitHub App installation.`,
  };
}

export async function createFlag(orgId: string): Promise<StepResult> {
  const connection = await getActiveConnection(orgId);
  try {
    const posthog = assertPosthogTarget(connection);
    return {
      step: "create_flag",
      ok: true,
      message: `Would POST a multivariate flag to project ${posthog.projectId} via createMultivariateFlag.`,
    };
  } catch (error) {
    return {
      step: "create_flag",
      ok: false,
      message: error instanceof Error ? error.message : "PostHog target missing",
    };
  }
}

export async function simulateTraffic(orgId: string): Promise<StepResult> {
  return stub(
    orgId,
    "simulate_traffic",
    "Would fire $feature_flag_called + click events into the tenant PostHog project.",
  );
}

export async function analyzeResults(orgId: string): Promise<StepResult> {
  return stub(
    orgId,
    "analyze_results",
    "Would pull aggregate flag counts via queryFlagEventCounts and discard the raw payload.",
  );
}

export async function updatePlaybook(orgId: string): Promise<StepResult> {
  return stub(
    orgId,
    "update_playbook",
    "Would write element/value/win_rate nodes for this org_id only.",
  );
}

export async function synthesizeNext(orgId: string): Promise<StepResult> {
  return stub(
    orgId,
    "synthesize_next",
    "Would read this org's playbook nodes and propose the next combined hypothesis.",
  );
}
