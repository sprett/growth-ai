import {
  analyzeResults,
  createFlag,
  generateDiff,
  openPr,
  parseRequest,
  simulateTraffic,
  synthesizeNext,
  updatePlaybook,
} from "@/lib/pipeline/steps";
import type { PipelineContext, PipelineStepName, StepResult } from "@/lib/pipeline/types";

export async function runStep(
  step: PipelineStepName,
  orgId: string,
  experimentId: string,
  context: PipelineContext,
): Promise<StepResult> {
  switch (step) {
    case "parse_request":
      return parseRequest(orgId, experimentId, context);
    case "generate_diff":
      return generateDiff(orgId, experimentId, context);
    case "open_pr":
      return openPr(orgId, experimentId, context);
    case "create_flag":
      return createFlag(orgId, experimentId, context);
    case "simulate_traffic":
      return simulateTraffic(orgId, experimentId, context);
    case "analyze_results":
      return analyzeResults(orgId, experimentId, context);
    case "update_playbook":
      return updatePlaybook(orgId, experimentId, context);
    case "synthesize_next":
      return synthesizeNext(orgId, experimentId, context);
    default: {
      const _exhaustive: never = step;
      throw new Error(`Unhandled pipeline step: ${_exhaustive}`);
    }
  }
}
