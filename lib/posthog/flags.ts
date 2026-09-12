import {
  posthogRequest,
  type PosthogTarget,
} from "@/lib/posthog/customer";

export type FeatureFlagSummary = {
  id: number;
  key: string;
  name: string;
  active: boolean;
};

export type FlagVariant = {
  key: string;
  name: string;
  rollout_percentage: number;
};

export async function listFeatureFlags(
  target: PosthogTarget,
): Promise<FeatureFlagSummary[]> {
  const response = await posthogRequest(
    target,
    `/api/projects/${target.projectId}/feature_flags/?limit=100`,
  );
  if (!response.ok) {
    throw new Error(`Failed to list flags (${response.status})`);
  }

  const payload = (await response.json()) as {
    results?: Array<{
      id: number;
      key: string;
      name: string;
      active: boolean;
    }>;
  };

  return (payload.results ?? []).map((flag) => ({
    id: flag.id,
    key: flag.key,
    name: flag.name,
    active: flag.active,
  }));
}

export async function createMultivariateFlag(
  target: PosthogTarget,
  input: { key: string; name: string; variants: FlagVariant[] },
): Promise<{ id: number; key: string }> {
  const response = await posthogRequest(
    target,
    `/api/projects/${target.projectId}/feature_flags/`,
    {
      method: "POST",
      body: JSON.stringify({
        key: input.key,
        name: input.name,
        active: true,
        filters: {
          multivariate: { variants: input.variants },
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to create flag (${response.status})`);
  }

  const created = (await response.json()) as { id: number; key: string };
  return { id: created.id, key: created.key };
}

export async function patchFeatureFlag(
  target: PosthogTarget,
  flagId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const response = await posthogRequest(
    target,
    `/api/projects/${target.projectId}/feature_flags/${flagId}/`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to update flag (${response.status})`);
  }
}
