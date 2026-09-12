import { createOctokitGithubClient } from "@/lib/github/octokit-client";
import type { GithubClient } from "@/lib/github/types";

export * from "@/lib/github/types";

export function getGithubClient(): GithubClient {
  return createOctokitGithubClient();
}
