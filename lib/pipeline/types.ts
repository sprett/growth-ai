export const DEMO_ORG_ID = "11111111-1111-4111-8111-111111111111";

export type Connection = {
  id: string;
  org_id: string;
  github_installation_id: string | null;
  github_repo_full_name: string | null;
  posthog_api_key: string | null;
  posthog_project_id: string | null;
  posthog_host: string | null;
};

export type PipelineStepName =
  | "parse_request"
  | "generate_diff"
  | "open_pr"
  | "create_flag"
  | "simulate_traffic"
  | "analyze_results"
  | "update_playbook"
  | "synthesize_next";

/**
 * The single source of truth for step order — app/api/pipeline/[experimentId]
 * and lib/pipeline/step-meta.ts both import this instead of keeping their own
 * copy, so they can't drift out of sync with each other.
 */
export const PIPELINE_STEP_ORDER: PipelineStepName[] = [
  "parse_request",
  "generate_diff",
  "open_pr",
  "create_flag",
  "simulate_traffic",
  "analyze_results",
  "update_playbook",
  "synthesize_next",
];

export type PipelineContext = {
  promptText: string;
  cycleNumber: number;
  activeHypothesis: Record<string, string> | null;
};

export type StepResult = {
  step: PipelineStepName;
  ok: boolean;
  message: string;
  nextHypothesis?: Record<string, string>;
};
