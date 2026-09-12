import { describe, expect, it } from "vitest";
import {
  parseFromStep,
  shouldPauseAfter,
  stepsFrom,
} from "@/lib/pipeline/schedule";

describe("shouldPauseAfter", () => {
  it("pauses after open_pr so tests don't run on unmerged code", () => {
    expect(shouldPauseAfter("open_pr")).toBe(true);
  });

  it("does not pause after any other step", () => {
    expect(shouldPauseAfter("parse_request")).toBe(false);
    expect(shouldPauseAfter("generate_diff")).toBe(false);
    expect(shouldPauseAfter("create_flag")).toBe(false);
    expect(shouldPauseAfter("simulate_traffic")).toBe(false);
    expect(shouldPauseAfter("analyze_results")).toBe(false);
    expect(shouldPauseAfter("update_playbook")).toBe(false);
    expect(shouldPauseAfter("synthesize_next")).toBe(false);
  });
});

describe("stepsFrom", () => {
  it("starts a new experiment from parse_request through open_pr", () => {
    expect(stepsFrom("parse_request")).toEqual([
      "parse_request",
      "generate_diff",
      "open_pr",
      "create_flag",
      "simulate_traffic",
      "analyze_results",
      "update_playbook",
      "synthesize_next",
    ]);
  });

  it("resumes after merge at create_flag, skipping the already-finished PR steps", () => {
    expect(stepsFrom("create_flag")).toEqual([
      "create_flag",
      "simulate_traffic",
      "analyze_results",
      "update_playbook",
      "synthesize_next",
    ]);
  });
});

describe("parseFromStep", () => {
  it("defaults a missing from param to parse_request", () => {
    expect(parseFromStep(null)).toBe("parse_request");
  });

  it("accepts a valid pipeline step", () => {
    expect(parseFromStep("create_flag")).toBe("create_flag");
  });

  it("rejects an unknown step", () => {
    expect(parseFromStep("not_a_step")).toBeNull();
  });
});
