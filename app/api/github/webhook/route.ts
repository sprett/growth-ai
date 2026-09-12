import { extractMergedPr, verifyGithubSignature } from "@/lib/github/webhook";
import { POST_MERGE_STEP } from "@/lib/pipeline/schedule";
import { pipelineOrigin, triggerPipeline } from "@/lib/pipeline/trigger";
import { createAdminSupabase } from "@/lib/supabase-admin";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyGithubSignature(secret, rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const merged = extractMergedPr(payload);
  if (!merged) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const admin = createAdminSupabase();
  const { data: variant, error } = await admin
    .from("variants")
    .select("experiment_id")
    .eq("pr_url", merged.htmlUrl)
    .maybeSingle();

  if (error || !variant) {
    return NextResponse.json({ ok: true, matched: false });
  }

  const experimentId = variant.experiment_id as string;
  const { data: experiment } = await admin
    .from("experiments")
    .select("status")
    .eq("id", experimentId)
    .maybeSingle();

  if (experiment?.status !== "pr_open") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  triggerPipeline(pipelineOrigin(request), experimentId, POST_MERGE_STEP);
  return NextResponse.json({ ok: true, resumed: true });
}
