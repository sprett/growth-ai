import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractMergedPr, verifyGithubSignature } from "@/lib/github/webhook";

describe("verifyGithubSignature", () => {
  const secret = "test-secret";
  const rawBody = JSON.stringify({ hello: "world" });
  const validSignature =
    "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  it("accepts a correctly signed body", () => {
    expect(verifyGithubSignature(secret, rawBody, validSignature)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyGithubSignature(secret, rawBody + "x", validSignature)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyGithubSignature(secret, rawBody, null)).toBe(false);
  });

  it("rejects a signature signed with the wrong secret", () => {
    const wrongSignature =
      "sha256=" + createHmac("sha256", "wrong").update(rawBody, "utf8").digest("hex");
    expect(verifyGithubSignature(secret, rawBody, wrongSignature)).toBe(false);
  });
});

describe("extractMergedPr", () => {
  it("extracts the html_url from a merged, closed PR payload", () => {
    const payload = {
      action: "closed",
      pull_request: { merged: true, html_url: "https://github.com/org/repo/pull/1" },
    };
    expect(extractMergedPr(payload)).toEqual({ htmlUrl: "https://github.com/org/repo/pull/1" });
  });

  it("returns null for a closed-but-not-merged PR", () => {
    const payload = {
      action: "closed",
      pull_request: { merged: false, html_url: "https://github.com/org/repo/pull/1" },
    };
    expect(extractMergedPr(payload)).toBeNull();
  });

  it("returns null for a non-closed action", () => {
    const payload = {
      action: "opened",
      pull_request: { merged: false, html_url: "https://github.com/org/repo/pull/1" },
    };
    expect(extractMergedPr(payload)).toBeNull();
  });

  it("returns null for a malformed payload", () => {
    expect(extractMergedPr("not an object")).toBeNull();
    expect(extractMergedPr(null)).toBeNull();
    expect(extractMergedPr({})).toBeNull();
  });
});
