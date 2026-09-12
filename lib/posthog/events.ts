import {
  posthogRequest,
  type PosthogTarget,
} from "@/lib/posthog/customer";

export type FlagVariantCount = {
  variant: string;
  event_count: number;
};

function assertFlagKey(flagKey: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(flagKey)) {
    throw new Error("Invalid feature flag key");
  }
  return flagKey;
}

export async function queryFlagEventCounts(
  target: PosthogTarget,
  flagKey: string,
): Promise<FlagVariantCount[]> {
  const safeKey = assertFlagKey(flagKey);

  const response = await posthogRequest(
    target,
    `/api/projects/${target.projectId}/query/`,
    {
      method: "POST",
      body: JSON.stringify({
        name: `growth-agent-flag-aggregates:${safeKey}`,
        query: {
          kind: "HogQLQuery",
          query: `
            SELECT
              ifNull(toString(properties.$feature_flag_response), 'unknown') AS variant,
              count() AS event_count
            FROM events
            WHERE properties.$feature_flag = '${safeKey}'
            GROUP BY variant
          `.trim(),
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to query flag events (${response.status})`);
  }

  const payload = (await response.json()) as {
    results?: Array<[string, number | string]>;
  };

  return (payload.results ?? []).map(([variant, eventCount]) => ({
    variant,
    event_count: Number(eventCount),
  }));
}
