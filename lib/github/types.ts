export type GithubTarget = {
  installationId: string;
  repoFullName: string;
  baseBranch: string;
};

export type FileEdit = { path: string; content: string };

export type OpenPrInput = {
  target: GithubTarget;
  branchName: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  files: FileEdit[];
};

export type OpenPrResult = {
  prUrl: string;
  prNumber: number;
  branchName: string;
};

export interface GithubClient {
  openPullRequest(input: OpenPrInput): Promise<OpenPrResult>;
  /** Returns null if the file doesn't exist at that ref (a new file). */
  getFileContent(target: GithubTarget, path: string): Promise<string | null>;
}
