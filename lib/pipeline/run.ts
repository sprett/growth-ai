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
import type { PipelineStepName, StepResult } from "@/lib/pipeline/types";

export async function runStep(
  step: PipelineStepName,
  orgId: string,
): Promise<StepResult> {
  switch (step) {
    case "parse_request":
      return parseRequest(orgId);
    case "generate_diff":
      return generateDiff(orgId);
    case "open_pr":
      return openPr(orgId);
    case "create_flag":
      return createFlag(orgId);
    case "simulate_traffic":
      return simulateTraffic(orgId);
    case "analyze_results":
      return analyzeResults(orgId);
    case "update_playbook":
      return updatePlaybook(orgId);
    case "synthesize_next":
      return synthesizeNext(orgId);
    default: {
      const _exhaustive: never = step;
      throw new Error(`Unhandled pipeline step: ${_exhaustive}`);
    }
  }
}
