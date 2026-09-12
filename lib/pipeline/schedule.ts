import { PIPELINE_STEP_ORDER, type PipelineStepName } from "@/lib/pipeline/types";

export function shouldPauseAfter(step: PipelineStepName): boolean {
  return step === "open_pr";
}

export function stepsFrom(from: PipelineStepName): PipelineStepName[] {
  const index = PIPELINE_STEP_ORDER.indexOf(from);
  if (index === -1) return [];
  return PIPELINE_STEP_ORDER.slice(index);
}

export function parseFromStep(value: string | null): PipelineStepName | null {
  if (value === null) return "parse_request";
  if ((PIPELINE_STEP_ORDER as readonly string[]).includes(value)) {
    return value as PipelineStepName;
  }
  return null;
}
