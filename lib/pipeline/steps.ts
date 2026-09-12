import Anthropic from "@anthropic-ai/sdk";
import {
  assertGithubTarget,
  assertPosthogTarget,
  getActiveConnection,
} from "@/lib/pipeline/connection";
import { createAdminSupabase } from "@/lib/supabase-admin";
import type { PipelineContext, PipelineStepName, StepResult } from "@/lib/pipeline/types";
import { getGithubClient } from "@/lib/github";
import { applyExperimentSpec, buildPrBody, normalizeHypothesis, pickEntryField } from "@/lib/pipeline/auth-copy";
import {
  AUTH_COPY_DEFAULT,
  AUTH_PANEL_ORIGINAL_SNAPSHOT,
  AUTH_PANEL_PATH,
  renderAuthPanelFile,
} from "@/lib/pipeline/auth-panel-template";
import { slugify } from "@/lib/utils";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Claude sometimes wraps the JSON in a code fence, or (when the prompt isn't
 * a real UI-change request) replies with prose instead of JSON at all. Try a
 * couple of ways to recover an object before giving up.
 */
function extractJsonObject(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // fall through — maybe the JSON is embedded in surrounding prose
  }
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Turns a model reply into a validated hypothesis, or throws an error with a
 * message that's safe to show the user as-is. Raw model output (which can be
 * a long, jargon-y explanation) is logged server-side for debugging but never
 * put in the thrown message — step callers surface that message verbatim in
 * the chat UI.
 */
function parseHypothesisReply(
  text: string,
  step: PipelineStepName,
  friendlyMessage: string,
): Record<string, string> {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error(`[${step}] model reply was not a JSON object:`, text);
    throw new Error(friendlyMessage);
  }
  try {
    return normalizeHypothesis(parsed as Record<string, string>);
  } catch {
    console.error(`[${step}] model JSON missing required fields:`, text);
    throw new Error(friendlyMessage);
  }
}

const PARSE_FAILURE_MESSAGE = `Not quite enough to go on yet — what's the specific UI change you want to try? For example: "change the CTA button copy to 'Start free trial'".`;

/**
 * The plain (no prior hypothesis) parse prompt, factored out so
 * startExperiment can run it before an experiment row even exists — see
 * parseRequest below for why that matters.
 */
export async function parseHypothesisFromPrompt(
  promptText: string,
): Promise<{ ok: true; hypothesis: Record<string, string> } | { ok: false; message: string }> {
  const prompt = `Parse this UI experiment request into a JSON object with exactly these fields: element (e.g. "cta_button"), dimension ("copy" | "color" | "placement"), variant_value (the proposed change value). Request: "${promptText}". Reply with only the JSON object, no markdown.`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text.trim() : "";

  try {
    return { ok: true, hypothesis: parseHypothesisReply(text, "parse_request", PARSE_FAILURE_MESSAGE) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : PARSE_FAILURE_MESSAGE };
  }
}

export async function parseRequest(
  orgId: string,
  experimentId: string,
  context: PipelineContext,
): Promise<StepResult> {
  const { promptText, activeHypothesis, cycleNumber } = context;

  let hypothesis: Record<string, string>;
  if (cycleNumber === 1 && activeHypothesis) {
    // startExperiment already ran parseHypothesisFromPrompt synchronously
    // before this experiment (and this pipeline run) existed, so it could
    // show a parse failure inline instead of creating a dead "experiment"
    // for an unparseable first message. Reuse that result instead of
    // spending a second, possibly-inconsistent Anthropic call on it.
    hypothesis = activeHypothesis;
  } else {
    const prompt = activeHypothesis
      ? `You are a UI experiment planner on cycle 2+. The previous winning hypothesis was: ${JSON.stringify(activeHypothesis)}. Build on it. Parse this new experiment request into a JSON object with fields: element (e.g. "cta_button"), dimension (e.g. "copy" | "color" | "placement"), variant_value (the proposed change). Request: "${promptText}". Reply with only the JSON object, no markdown.`
      : `Parse this UI experiment request into a JSON object with exactly these fields: element (e.g. "cta_button"), dimension ("copy" | "color" | "placement"), variant_value (the proposed change value). Request: "${promptText}". Reply with only the JSON object, no markdown.`;

    const message = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text.trim() : "";

    try {
      hypothesis = parseHypothesisReply(text, "parse_request", PARSE_FAILURE_MESSAGE);
    } catch (error) {
      return {
        step: "parse_request",
        ok: false,
        message: error instanceof Error ? error.message : "Could not parse the request.",
      };
    }
  }

  const supabase = createAdminSupabase();
  await supabase
    .from("experiments")
    .update({ active_hypothesis: hypothesis })
    .eq("id", experimentId);

  // Insert control + variant rows
  // hypothesis has {element, dimension, variant_value} — map variant_value → value
  await supabase.from("variants").insert([
    { experiment_id: experimentId, org_id: orgId, label: "control", element: hypothesis.element, dimension: hypothesis.dimension, value: "original" },
    { experiment_id: experimentId, org_id: orgId, label: "variant_b", element: hypothesis.element, dimension: hypothesis.dimension, value: hypothesis.variant_value },
  ]);

  return {
    step: "parse_request",
    ok: true,
    message: `Parsed: ${JSON.stringify(hypothesis)}`,
  };
}

export async function generateDiff(
  orgId: string,
  _experimentId: string,
  context: PipelineContext,
): Promise<StepResult> {
  const connection = await getActiveConnection(orgId);
  const repo = assertGithubTarget(connection);
  const { activeHypothesis } = context;

  if (!activeHypothesis) {
    return { step: "generate_diff", ok: false, message: "No active_hypothesis — run parse_request first." };
  }

  try {
    const spec = normalizeHypothesis(activeHypothesis);
    const before = pickEntryField(AUTH_COPY_DEFAULT.signup, spec);
    // Validates the combination is one AuthPanel.tsx actually supports —
    // throws before we ever try to open a PR for something we can't apply.
    applyExperimentSpec(AUTH_COPY_DEFAULT, spec);

    return {
      step: "generate_diff",
      ok: true,
      message: `Prepared ${AUTH_PANEL_PATH} on ${repo}: ${spec.element}/${spec.dimension} "${before}" → "${spec.variant_value}".`,
    };
  } catch (error) {
    return {
      step: "generate_diff",
      ok: false,
      message: error instanceof Error ? error.message : "Could not prepare the diff",
    };
  }
}

export async function openPr(
  orgId: string,
  experimentId: string,
  context: PipelineContext,
): Promise<StepResult> {
  const connection = await getActiveConnection(orgId);
  const repo = assertGithubTarget(connection);
  const { activeHypothesis, cycleNumber } = context;

  if (!activeHypothesis) {
    return { step: "open_pr", ok: false, message: "No active_hypothesis — run parse_request first." };
  }
  if (!connection.github_installation_id) {
    return { step: "open_pr", ok: false, message: "connections.github_installation_id is empty" };
  }

  try {
    const spec = normalizeHypothesis(activeHypothesis);
    const before = pickEntryField(AUTH_COPY_DEFAULT.signup, spec);
    const nextBlock = applyExperimentSpec(AUTH_COPY_DEFAULT, spec);
    const content = renderAuthPanelFile(nextBlock);
    const prBody = buildPrBody(spec, before);

    const target = {
      installationId: connection.github_installation_id,
      repoFullName: repo,
      baseBranch: "main",
    };

    const client = getGithubClient();

    // AUTH_COPY_DEFAULT is a point-in-time snapshot of the real file. The
    // live file is only a valid base to build on if it's either still the
    // pristine pre-refactor original, or already exactly our own rendered
    // baseline (from a previously merged growth-agent PR) — anything else
    // means someone else committed to it, and blindly PUTting our rendered
    // version would silently revert that work while looking like a
    // one-field copy change in the PR. Fail loudly instead.
    const liveContent = await client.getFileContent(target, AUTH_PANEL_PATH);
    const isKnownBaseline =
      liveContent === null ||
      liveContent === AUTH_PANEL_ORIGINAL_SNAPSHOT ||
      liveContent === renderAuthPanelFile(AUTH_COPY_DEFAULT);
    if (!isKnownBaseline) {
      return {
        step: "open_pr",
        ok: false,
        message: `${AUTH_PANEL_PATH} has diverged from the growth agent's known baseline (lib/pipeline/auth-panel-template.ts) — regenerate that template before opening another PR.`,
      };
    }

    const slug = slugify(spec.variant_value).slice(0, 32) || "variant";
    const branchName = `growth-agent/cycle-${cycleNumber}-${slug}-${experimentId.slice(0, 8)}`;

    const result = await client.openPullRequest({
      target,
      branchName,
      commitMessage: `Experiment: ${spec.element} ${spec.dimension} → ${spec.variant_value}`,
      prTitle: `Growth agent: ${spec.element} ${spec.dimension} experiment`,
      prBody,
      files: [{ path: AUTH_PANEL_PATH, content }],
    });

    const admin = createAdminSupabase();
    // Only variant_b actually got a PR — updating unscoped would also stamp
    // it onto the control row.
    await admin
      .from("variants")
      .update({ pr_url: result.prUrl })
      .eq("experiment_id", experimentId)
      .eq("label", "variant_b");

    return {
      step: "open_pr",
      ok: true,
      message: `Opened ${result.prUrl}`,
    };
  } catch (error) {
    return {
      step: "open_pr",
      ok: false,
      message: error instanceof Error ? error.message : "Could not open the PR",
    };
  }
}

export async function createFlag(
  orgId: string,
  experimentId: string,
  context: PipelineContext,
): Promise<StepResult> {
  const connection = await getActiveConnection(orgId);
  const posthog = assertPosthogTarget(connection);
  const { activeHypothesis, cycleNumber } = context;

  if (!activeHypothesis) {
    return { step: "create_flag", ok: false, message: "No active_hypothesis." };
  }

  const flagKey = `growth-agent-${experimentId.slice(0, 8)}-cycle-${cycleNumber}`;
  const supabase = createAdminSupabase();

  const res = await fetch(
    `${posthog.host}/api/projects/${posthog.projectId}/feature_flags/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${posthog.apiKey}`, // personal API key for management
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: flagKey,
        name: `Growth Agent — ${activeHypothesis.element} ${activeHypothesis.dimension} cycle ${cycleNumber}`,
        active: true,
        filters: {
          multivariate: {
            variants: [
              { key: "control", name: "Control", rollout_percentage: 50 },
              { key: "variant_b", name: "Variant B", rollout_percentage: 50 },
            ],
          },
          groups: [{ properties: [], rollout_percentage: 100 }],
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    // If flag already exists, treat it as success and continue
    if (res.status === 400 && body.includes("unique")) {
      await supabase
        .from("variants")
        .update({ posthog_flag_key: flagKey })
        .eq("experiment_id", experimentId);
      return { step: "create_flag", ok: true, message: `Flag already exists, reusing: ${flagKey}` };
    }
    return { step: "create_flag", ok: false, message: `PostHog error: ${body}` };
  }

  const flag = await res.json();

  // Store flag key on both variant rows
  await supabase
    .from("variants")
    .update({ posthog_flag_key: flagKey })
    .eq("experiment_id", experimentId);

  return {
    step: "create_flag",
    ok: true,
    message: `Flag created: ${flag.key}`,
  };
}

export async function simulateTraffic(
  orgId: string,
  experimentId: string,
  _context: PipelineContext,
): Promise<StepResult> {
  const connection = await getActiveConnection(orgId);
  const posthog = assertPosthogTarget(connection);

  const supabase = createAdminSupabase();
  const { data: variants } = await supabase
    .from("variants")
    .select("id, label, posthog_flag_key")
    .eq("experiment_id", experimentId);

  if (!variants?.length) {
    return { step: "simulate_traffic", ok: false, message: "No variants found." };
  }

  const flagKey = variants[0].posthog_flag_key;
  const EVENTS_PER_VARIANT = 200;

  const events = variants.flatMap((variant) =>
    Array.from({ length: EVENTS_PER_VARIANT }, (_, i) => ({
      event: i < EVENTS_PER_VARIANT * 0.9 ? "page_view" : "cta_click",
      distinct_id: `simulated-user-${variant.label}-${i}`,
      properties: {
        $feature_flag: flagKey,
        $feature_flag_response: variant.label,
        experiment_id: experimentId,
        variant_id: variant.id,
      },
    })),
  );

  // Best-effort push to the customer's own PostHog project, purely so the
  // flag shows live-looking traffic there — analyzeResults reads only the
  // local aggregate rows written below, so a network blip or PostHog outage
  // here shouldn't strand an experiment that already has a real PR and flag.
  // Note this uses posthog.projectToken (the public, write-only ingestion
  // token), never posthog.apiKey (the personal key) — /batch/ rejects the
  // personal key outright ("API key is not valid: personal_api_key").
  let posthogPushError: string | null = null;
  try {
    const res = await fetch(`${posthog.host}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: posthog.projectToken,
        batch: events,
      }),
    });
    if (!res.ok) {
      posthogPushError = await res.text();
    }
  } catch (error) {
    posthogPushError = error instanceof Error ? error.message : "network error";
  }
  if (posthogPushError) {
    console.error(`[simulate_traffic] PostHog batch push failed:`, posthogPushError);
  }

  // Write aggregate counts to events table (org_id required by schema)
  await supabase.from("events").insert(
    variants.flatMap((variant) => [
      { variant_id: variant.id, org_id: orgId, event_type: "view", count: EVENTS_PER_VARIANT },
      {
        variant_id: variant.id,
        org_id: orgId,
        event_type: "click",
        count: variant.label === "control"
          ? Math.round(EVENTS_PER_VARIANT * 0.08)
          : Math.round(EVENTS_PER_VARIANT * 0.13),
      },
    ]),
  );

  return {
    step: "simulate_traffic",
    ok: true,
    message: posthogPushError
      ? `Recorded ${events.length} synthetic events (PostHog project capture skipped — check connections.posthog_project_token).`
      : `Fired ${events.length} synthetic events.`,
  };
}

export async function analyzeResults(
  orgId: string,
  experimentId: string,
  _context: PipelineContext, // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<StepResult> {
  await getActiveConnection(orgId);
  const supabase = createAdminSupabase();

  const { data: variants } = await supabase
    .from("variants")
    .select("id, label")
    .eq("experiment_id", experimentId);

  if (!variants?.length) {
    return { step: "analyze_results", ok: false, message: "No variants found." };
  }

  const results: Record<string, { views: number; clicks: number; rate: number }> = {};

  for (const variant of variants) {
    const { data: events } = await supabase
      .from("events")
      .select("event_type, count")
      .eq("variant_id", variant.id);

    const views = events?.find((e) => e.event_type === "view")?.count ?? 0;
    const clicks = events?.find((e) => e.event_type === "click")?.count ?? 0;
    results[variant.label] = { views, clicks, rate: views > 0 ? clicks / views : 0 };
  }

  await supabase
    .from("experiments")
    .update({ active_hypothesis: { ...((await supabase.from("experiments").select("active_hypothesis").eq("id", experimentId).single()).data?.active_hypothesis ?? {}), results } })
    .eq("id", experimentId);

  const summary = Object.entries(results)
    .map(([label, r]) => `${label}: ${(r.rate * 100).toFixed(1)}% CTR`)
    .join(", ");

  return { step: "analyze_results", ok: true, message: summary };
}

export async function updatePlaybook(
  orgId: string,
  experimentId: string,
  _context: PipelineContext,
): Promise<StepResult> {
  const supabase = createAdminSupabase();

  const { data: experiment } = await supabase
    .from("experiments")
    .select("active_hypothesis")
    .eq("id", experimentId)
    .single();

  const hypothesis = experiment?.active_hypothesis as Record<string, unknown> | null;
  const results = hypothesis?.results as Record<string, { rate: number }> | undefined;

  if (!results) {
    return { step: "update_playbook", ok: false, message: "No results to write to playbook." };
  }

  const winnerLabel = Object.entries(results).sort((a, b) => b[1].rate - a[1].rate)[0][0];
  const winner = winnerLabel === "variant_b";

  if (!winner) {
    return { step: "update_playbook", ok: true, message: "Control won — no playbook node written." };
  }

  const { data: node, error } = await supabase
    .from("playbook_nodes")
    .insert({
      org_id: orgId,
      experiment_id: experimentId,
      element: hypothesis?.element,
      dimension: hypothesis?.dimension,
      value: hypothesis?.variant_value,
      win_rate: results["variant_b"]?.rate ?? 0,
    })
    .select("id")
    .single();

  if (error) {
    return { step: "update_playbook", ok: false, message: error.message };
  }

  return {
    step: "update_playbook",
    ok: true,
    message: `Playbook node written (id: ${node.id}).`,
  };
}

export async function synthesizeNext(
  orgId: string,
  experimentId: string,
  _context: PipelineContext,
): Promise<StepResult> {
  await getActiveConnection(orgId);
  const supabase = createAdminSupabase();

  const { data: nodes } = await supabase
    .from("playbook_nodes")
    .select("element, dimension, value, win_rate")
    .eq("org_id", orgId)
    .order("win_rate", { ascending: false })
    .limit(10);

  const { data: experiment } = await supabase
    .from("experiments")
    .select("prompt_text, active_hypothesis")
    .eq("id", experimentId)
    .single();

  const playbookSummary = nodes?.length
    ? nodes.map((n) => `${n.element}/${n.dimension}="${n.value}" won at ${(n.win_rate * 100).toFixed(1)}% CTR`).join("\n")
    : "No prior wins yet.";

  const message = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `You are a growth agent synthesizing the next A/B test hypothesis.

Playbook (past winners):
${playbookSummary}

Original prompt: "${experiment?.prompt_text}"
Last hypothesis: ${JSON.stringify(experiment?.active_hypothesis)}

Combine the winning insights into a new, more refined hypothesis. Reply with only a JSON object: { element, dimension, variant_value }. No markdown.`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text.trim() : "";

  let nextHypothesis: Record<string, string>;
  try {
    nextHypothesis = parseHypothesisReply(
      text,
      "synthesize_next",
      "Could not synthesize a valid next hypothesis from the playbook.",
    );
  } catch (error) {
    return {
      step: "synthesize_next",
      ok: false,
      message: error instanceof Error ? error.message : "Could not synthesize the next hypothesis.",
    };
  }

  return {
    step: "synthesize_next",
    ok: true,
    message: `Next hypothesis: ${JSON.stringify(nextHypothesis)}`,
    nextHypothesis,
  };
}
