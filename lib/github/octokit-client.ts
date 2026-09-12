import { App } from "@octokit/app";
import type { GithubClient, GithubTarget, OpenPrInput, OpenPrResult } from "@/lib/github/types";

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

function isUnprocessableError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && (error as { status?: number }).status === 422;
}

async function getInstallationOctokit(installationId: string) {
  const app = getApp();
  const numericId = Number(installationId);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    throw new Error(`Invalid github_installation_id: "${installationId}"`);
  }
  return app.getInstallationOctokit(numericId);
}

export function createOctokitGithubClient(): GithubClient {
  return {
    async getFileContent(target: GithubTarget, path: string): Promise<string | null> {
      const octokit = await getInstallationOctokit(target.installationId);
      const { owner, repo } = splitRepoFullName(target.repoFullName);

      try {
        const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
          owner,
          repo,
          path,
          ref: target.baseBranch,
        });
        if (Array.isArray(data) || data.type !== "file") {
          return null;
        }
        return Buffer.from(data.content, "base64").toString("utf8");
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },

    async listFilePaths(target: GithubTarget): Promise<string[]> {
      const octokit = await getInstallationOctokit(target.installationId);
      const { owner, repo } = splitRepoFullName(target.repoFullName);

      const { data } = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
        owner,
        repo,
        tree_sha: target.baseBranch,
        recursive: "true",
      });

      return (data.tree ?? [])
        .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
        .map((entry) => entry.path as string);
    },

    async openPullRequest(input: OpenPrInput): Promise<OpenPrResult> {
      const octokit = await getInstallationOctokit(input.target.installationId);
      const { owner, repo } = splitRepoFullName(input.target.repoFullName);

      const { data: baseRef } = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
        owner,
        repo,
        ref: `heads/${input.target.baseBranch}`,
      });
      const baseSha = baseRef.object.sha;

      // branchName is deterministic (derived from cycle/slug/experiment id),
      // so a second run against the same experiment collides with a
      // "Reference already exists" 422. Fall back to a randomized suffix
      // once rather than hard-failing or leaving the caller to retry.
      let branchName = input.branchName;
      try {
        await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
          owner,
          repo,
          ref: `refs/heads/${branchName}`,
          sha: baseSha,
        });
      } catch (error) {
        if (!isUnprocessableError(error)) {
          throw error;
        }
        branchName = `${input.branchName}-${Math.random().toString(36).slice(2, 8)}`;
        await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
          owner,
          repo,
          ref: `refs/heads/${branchName}`,
          sha: baseSha,
        });
      }

      for (const file of input.files) {
        let existingSha: string | undefined;
        try {
          const { data: existing } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
            owner,
            repo,
            path: file.path,
            ref: branchName,
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
          branch: branchName,
          ...(existingSha ? { sha: existingSha } : {}),
        });
      }

      const { data: pr } = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
        owner,
        repo,
        title: input.prTitle,
        head: branchName,
        base: input.target.baseBranch,
        body: input.prBody,
      });

      return { prUrl: pr.html_url, prNumber: pr.number, branchName };
    },
  };
}
