export type ConnectionRow = {
  github_installation_id: string | null;
  github_repo_full_name: string | null;
  posthog_api_key: string | null;
  posthog_project_token: string | null;
  posthog_project_id: string | null;
  posthog_host: string | null;
};

export type PublicConnection = {
  github_installation_id: string | null;
  github_repo_full_name: string | null;
  posthog_project_id: string | null;
  posthog_host: string | null;
  posthog_connected: boolean;
  posthog_project_token_set: boolean;
};

export function toPublicConnection(
  row: ConnectionRow | null,
): PublicConnection | null {
  if (!row) {
    return null;
  }

  return {
    github_installation_id: row.github_installation_id,
    github_repo_full_name: row.github_repo_full_name,
    posthog_project_id: row.posthog_project_id,
    posthog_host: row.posthog_host,
    posthog_connected: Boolean(row.posthog_api_key),
    posthog_project_token_set: Boolean(row.posthog_project_token),
  };
}

export function isGithubConnected(connection: PublicConnection | null): boolean {
  return Boolean(connection?.github_installation_id);
}

export function isPosthogConnected(connection: PublicConnection | null): boolean {
  return Boolean(
    connection?.posthog_connected &&
      connection.posthog_project_id &&
      connection.posthog_host,
  );
}

export function isOnboarded(connection: PublicConnection | null): boolean {
  return isGithubConnected(connection) && isPosthogConnected(connection);
}

/** Accepts a slug (`my-app`) or a github.com/apps/... URL. */
export function githubAppInstallUrl(slugOrUrl: string | null): string | null {
  const value = slugOrUrl?.trim();
  if (!value) {
    return null;
  }

  const fromUrl = [...value.matchAll(/github\.com\/apps\/([^/?#]+)/gi)];
  const slug = (fromUrl.at(-1)?.[1] ?? value).replace(/^\/+|\/+$/g, "");
  if (!slug || slug.includes("/") || slug.includes("://")) {
    return null;
  }

  return `https://github.com/apps/${slug}/installations/new`;
}
