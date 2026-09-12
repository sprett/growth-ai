import Anthropic from "@anthropic-ai/sdk";
import { App } from "@octokit/app";
import {
  assertGithubTarget,
  assertPosthogTarget,
  getActiveConnection,
} from "@/lib/pipeline/connection";
import { createAdminSupabase } from "@/lib/supabase-admin";
import type { PipelineContext, StepResult } from "@/lib/pipeline/types";

async function getInstallationOctokit(installationId: string) {
  const privateKey = (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  const app = new App({ appId: process.env.GITHUB_APP_ID ?? "", privateKey });
  return app.getInstallationOctokit(Number(installationId));
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function parseRequest(
  orgId: string,
  experimentId: string,
  context: PipelineContext,
): Promise<StepResult> {
  const { promptText, activeHypothesis } = context;

  const prompt = activeHypothesis
    ? `You are a UI experiment planner on cycle 2+. The previous winning hypothesis was: ${JSON.stringify(activeHypothesis)}. Build on it. Parse this new experiment request into a JSON object with fields: element (e.g. "cta_button"), dimension (e.g. "copy" | "color" | "placement"), variant_value (the proposed change). Request: "${promptText}". Reply with only the JSON object, no markdown.`
    : `Parse this UI experiment request into a JSON object with exactly these fields: element (e.g. "cta_button"), dimension ("copy" | "color" | "placement"), variant_value (the proposed change value). Request: "${promptText}". Reply with only the JSON object, no markdown.`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text.trim() : "";

  const jsonMatchParse = text.match(/\{[\s\S]*\}/);
  let hypothesis: Record<string, string>;
  try {
    hypothesis = JSON.parse(jsonMatchParse?.[0] ?? text);
  } catch {
    return {
      step: "parse_request",
      ok: false,
      message: `Claude returned unparseable JSON: ${text}`,
    };
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
  experimentId: string,
  context: PipelineContext,
): Promise<StepResult> {
  const connection = await getActiveConnection(orgId);
  const repoFull = assertGithubTarget(connection);
  const { activeHypothesis, cycleNumber } = context;

  if (!activeHypothesis) {
    return { step: "generate_diff", ok: false, message: "No active_hypothesis — run parse_request first." };
  }

  if (!connection.github_installation_id) {
    return { step: "generate_diff", ok: false, message: "No github_installation_id in connections." };
  }

  const [owner, repo] = repoFull.split("/");
  const octokit = await getInstallationOctokit(connection.github_installation_id);

  // 1. Get file tree
  const { data: tree } = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
    owner, repo, tree_sha: "HEAD", recursive: "1",
  });
  const filePaths = tree.tree
    .filter((f) => f.type === "blob" && /\.(tsx?|jsx?|css|html)$/.test(f.path ?? ""))
    .map((f) => f.path as string)
    .slice(0, 30); // cap to avoid huge context

  // 2. Read up to 5 most likely relevant files — ask Claude which ones matter
  const pickRes = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 256,
    messages: [{
      role: "user",
      content: `Given this UI experiment hypothesis: ${JSON.stringify(activeHypothesis)}\n\nThese are the source files in the repo:\n${filePaths.join("\n")}\n\nWhich 1-3 files are most likely to contain the UI element that needs to change? Reply with only a JSON array of file paths, no markdown.`,
    }],
  });

  const pickText = pickRes.content[0].type === "text" ? pickRes.content[0].text.trim() : "[]";
  let targetFiles: string[];
  try {
    targetFiles = JSON.parse(pickText);
  } catch {
    targetFiles = [filePaths[0]];
  }

  // 3. Read those files
  const fileContents: Record<string, { content: string; sha: string }> = {};
  for (const path of targetFiles.slice(0, 3)) {
    try {
      const { data: file } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner, repo, path,
      }) as { data: { content: string; sha: string } };
      fileContents[path] = {
        content: Buffer.from(file.content, "base64").toString("utf8"),
        sha: file.sha,
      };
    } catch {
      // file not found, skip
    }
  }

  if (Object.keys(fileContents).length === 0) {
    return { step: "generate_diff", ok: false, message: "Could not read any target files from repo." };
  }

  // 4. Ask Claude to generate the modified file
  const fileList = Object.entries(fileContents)
    .map(([path, { content }]) => `=== ${path} ===\n${content}`)
    .join("\n\n");

  const diffRes = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 8192,
    messages: [{
      role: "user",
      content: `You are a UI engineer implementing an A/B test variant. Apply ONLY the minimal change needed to implement this hypothesis:

Element: ${activeHypothesis.element}
Dimension: ${activeHypothesis.dimension}
Variant value: ${activeHypothesis.variant_value}

Here are the relevant source files:

${fileList}

Pick ONE file to modify. Return a JSON object with exactly two fields:
- "path": the file path you modified (must be one of the files above)
- "content": the COMPLETE new file content with only the minimal change applied

Reply with only the JSON object, no markdown, no explanation.`,
    }],
  });

  const diffText = diffRes.content[0].type === "text" ? diffRes.content[0].text.trim() : "";
  // Extract JSON from response — Claude sometimes prepends explanation text
  const jsonMatch = diffText.match(/\{[\s\S]*\}/);
  let generated: { path: string; content: string };
  try {
    generated = JSON.parse(jsonMatch?.[0] ?? diffText);
  } catch {
    return { step: "generate_diff", ok: false, message: `Claude returned unparseable diff: ${diffText.slice(0, 200)}` };
  }

  // 5. Store result in active_hypothesis for openPr to use
  const supabase = createAdminSupabase();
  const branchName = `agent/experiment-${experimentId.slice(0, 8)}-cycle-${cycleNumber}`;
  await supabase
    .from("experiments")
    .update({
      active_hypothesis: {
        ...activeHypothesis,
        target_file: generated.path,
        new_content: generated.content,
        original_sha: fileContents[generated.path]?.sha ?? "",
        branch_name: branchName,
      },
    })
    .eq("id", experimentId);

  return {
    step: "generate_diff",
    ok: true,
    message: `Generated change in ${generated.path} for branch ${branchName}`,
  };
}

export async function openPr(
  orgId: string,
  experimentId: string,
  _context: PipelineContext,
): Promise<StepResult> {
  const connection = await getActiveConnection(orgId);
  const repoFull = assertGithubTarget(connection);

  if (!connection.github_installation_id) {
    return { step: "open_pr", ok: false, message: "No github_installation_id in connections." };
  }

  // Read fresh hypothesis (generateDiff stored target_file + new_content here)
  const supabase = createAdminSupabase();
  const { data: exp } = await supabase
    .from("experiments")
    .select("active_hypothesis, prompt_text")
    .eq("id", experimentId)
    .single();

  const hypothesis = exp?.active_hypothesis as Record<string, string> | null;
  if (!hypothesis?.target_file || !hypothesis?.new_content || !hypothesis?.branch_name) {
    return { step: "open_pr", ok: false, message: "No generated diff found — run generate_diff first." };
  }

  const [owner, repo] = repoFull.split("/");
  const octokit = await getInstallationOctokit(connection.github_installation_id);
  const baseBranch = "main";

  // 1. Get base SHA
  const { data: ref } = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
    owner, repo, ref: `heads/${baseBranch}`,
  });
  const baseSha = ref.object.sha;

  // 2. Create branch (ignore if already exists)
  try {
    await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
      owner, repo,
      ref: `refs/heads/${hypothesis.branch_name}`,
      sha: baseSha,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (!msg.includes("already exists") && !msg.includes("Reference already exists")) {
      return { step: "open_pr", ok: false, message: `Branch creation failed: ${msg}` };
    }
  }

  // 3. Commit the generated file
  await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
    owner, repo,
    path: hypothesis.target_file,
    message: `experiment(agent): ${hypothesis.element} ${hypothesis.dimension} → ${hypothesis.variant_value}`,
    content: Buffer.from(hypothesis.new_content).toString("base64"),
    sha: hypothesis.original_sha,
    branch: hypothesis.branch_name,
  });

  // 4. Open the PR
  const { data: pr } = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
    owner, repo,
    title: `[Agent] ${hypothesis.element}: ${hypothesis.variant_value}`,
    head: hypothesis.branch_name,
    base: baseBranch,
    body: `## A/B Experiment\n\n**Element:** ${hypothesis.element}\n**Dimension:** ${hypothesis.dimension}\n**Variant:** ${hypothesis.variant_value}\n\n**Original prompt:** ${exp?.prompt_text ?? ""}\n\n_Opened automatically by Growth Agent._`,
  });

  // 5. Store PR URL on variant rows
  await supabase
    .from("variants")
    .update({ pr_url: pr.html_url })
    .eq("experiment_id", experimentId)
    .eq("label", "variant_b");

  return {
    step: "open_pr",
    ok: true,
    message: `PR opened: ${pr.html_url}`,
  };
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

  // PostHog batch endpoint uses project token (phc_), not personal API key
  const res = await fetch(`${posthog.host}/batch/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: posthog.projectToken,
      batch: events,
    }),
  });

  if (!res.ok) {
    return { step: "simulate_traffic", ok: false, message: `PostHog batch error: ${await res.text()}` };
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
    message: `Fired ${events.length} synthetic events.`,
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

  const jsonMatchSynth = text.match(/\{[\s\S]*\}/);
  let nextHypothesis: Record<string, string>;
  try {
    nextHypothesis = JSON.parse(jsonMatchSynth?.[0] ?? text);
  } catch {
    return {
      step: "synthesize_next",
      ok: false,
      message: `Claude returned unparseable JSON: ${text}`,
    };
  }

  return {
    step: "synthesize_next",
    ok: true,
    message: `Next hypothesis: ${JSON.stringify(nextHypothesis)}`,
    nextHypothesis,
  };
}
