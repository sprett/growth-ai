import { createAdminSupabase } from "@/lib/supabase-admin";
import type { Connection } from "@/lib/pipeline/types";

export async function getActiveConnection(orgId: string): Promise<Connection> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("connections")
    .select(
      "id, org_id, github_installation_id, github_repo_full_name, posthog_api_key, posthog_project_token, posthog_project_id, posthog_host",
    )
    .eq("org_id", orgId)
    .single();

  if (error || !data) {
    throw new Error(
      error?.message ?? "No connections row for this org. Finish onboarding first.",
    );
  }

  return data;
}

export function assertGithubTarget(connection: Connection): string {
  if (!connection.github_repo_full_name) {
    throw new Error("connections.github_repo_full_name is empty");
  }
  return connection.github_repo_full_name;
}

export function assertPosthogTarget(connection: Connection): {
  apiKey: string;
  projectToken: string;
  projectId: string;
  host: string;
} {
  if (
    !connection.posthog_api_key ||
    !connection.posthog_project_token ||
    !connection.posthog_project_id ||
    !connection.posthog_host
  ) {
    throw new Error(
      "connections is missing PostHog fields. Finish Connect PostHog in onboarding.",
    );
  }

  return {
    apiKey: connection.posthog_api_key,
    projectToken: connection.posthog_project_token,
    projectId: connection.posthog_project_id,
    host: connection.posthog_host,
  };
}
