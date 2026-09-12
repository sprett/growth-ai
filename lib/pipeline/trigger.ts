import type { PipelineStepName } from "@/lib/pipeline/types";

export function pipelineOrigin(req: Request): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  return new URL(req.url).origin;
}

export function triggerPipeline(
  origin: string,
  experimentId: string,
  from: PipelineStepName = "parse_request",
): void {
  const secret = process.env.PIPELINE_INTERNAL_SECRET;
  const url = new URL(`/api/pipeline/${experimentId}`, origin);
  url.searchParams.set("from", from);
  fetch(url, {
    method: "POST",
    headers: secret ? { "x-pipeline-secret": secret } : undefined,
  }).catch(() => {});
}
