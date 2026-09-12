import { App } from "@octokit/app";
import type { GithubClient, OpenPrInput, OpenPrResult } from "@/lib/github/types";

let cachedApp: App | null = null;

function getApp(): App {
  if (cachedApp) {
    return cachedApp;
  }

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY are not set");
  }

  cachedApp = new App({ appId, privateKey });
  return cachedApp;
}

function splitRepoFullName(repoFullName: string): { owner: string; repo: string } {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repoFullName: "${repoFullName}"`);
  }
  return { owner, repo };
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && (error as { status?: number }).status === 404;
}

export function createOctokitGithubClient(): GithubClient {
  return {
    async openPullRequest(input: OpenPrInput): Promise<OpenPrResult> {
      const app = getApp();
      const installationId = Number(input.target.installationId);
      if (!Number.isFinite(installationId) || installationId <= 0) {
        throw new Error(`Invalid github_installation_id: "${input.target.installationId}"`);
      }

      const octokit = await app.getInstallationOctokit(installationId);
      const { owner, repo } = splitRepoFullName(input.target.repoFullName);

      const { data: baseRef } = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
        owner,
        repo,
        ref: `heads/${input.target.baseBranch}`,
      });
      const baseSha = baseRef.object.sha;

      await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
        owner,
        repo,
        ref: `refs/heads/${input.branchName}`,
        sha: baseSha,
      });

      for (const file of input.files) {
        let existingSha: string | undefined;
        try {
          const { data: existing } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
            owner,
            repo,
            path: file.path,
            ref: input.branchName,
          });
          if (!Array.isArray(existing)) {
            existingSha = existing.sha;
          }
        } catch (error) {
          if (!isNotFoundError(error)) {
            throw error;
          }
        }

        await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
          owner,
          repo,
          path: file.path,
          message: input.commitMessage,
          content: Buffer.from(file.content, "utf8").toString("base64"),
          branch: input.branchName,
          ...(existingSha ? { sha: existingSha } : {}),
        });
      }

      const { data: pr } = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
        owner,
        repo,
        title: input.prTitle,
        head: input.branchName,
        base: input.target.baseBranch,
        body: input.prBody,
      });

      return { prUrl: pr.html_url, prNumber: pr.number, branchName: input.branchName };
    },
  };
}
