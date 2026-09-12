import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGithubSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader) {
    return false;
  }

  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

export type MergedPr = { htmlUrl: string };

export function extractMergedPr(payload: unknown): MergedPr | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const body = payload as Record<string, unknown>;
  if (body.action !== "closed") {
    return null;
  }

  const pr = body.pull_request as Record<string, unknown> | undefined;
  if (!pr || pr.merged !== true) {
    return null;
  }

  const htmlUrl = pr.html_url;
  if (typeof htmlUrl !== "string") {
    return null;
  }

  return { htmlUrl };
}
