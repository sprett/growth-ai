import {
  Activity,
  BarChart3,
  BookOpen,
  Flag,
  GitPullRequest,
  MessageSquareText,
  Sparkles,
  SquarePen,
  type LucideIcon,
} from "lucide-react";
import { PIPELINE_STEP_ORDER, type PipelineStepName } from "@/lib/pipeline/types";

export const STEP_ORDER = PIPELINE_STEP_ORDER;

export const STEP_META: Record<PipelineStepName, { label: string; icon: LucideIcon }> = {
  parse_request: { label: "Parse request", icon: MessageSquareText },
  generate_diff: { label: "Generate diff", icon: SquarePen },
  open_pr: { label: "Open PR", icon: GitPullRequest },
  create_flag: { label: "Create flag", icon: Flag },
  simulate_traffic: { label: "Simulate traffic", icon: Activity },
  analyze_results: { label: "Analyze results", icon: BarChart3 },
  update_playbook: { label: "Update playbook", icon: BookOpen },
  synthesize_next: { label: "Synthesize next hypothesis", icon: Sparkles },
};
