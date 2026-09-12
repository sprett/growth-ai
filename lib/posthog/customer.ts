export type PosthogTarget = {
  apiKey: string;
  projectId: string;
  host: string;
};

export const POSTHOG_KEY_SCOPES = [
  "feature_flag:read",
  "feature_flag:write",
  "query:read",
] as const;

export function posthogAppHost(host: string): string {
  const trimmed = host.replace(/\/$/, "");
  if (trimmed.includes("eu")) {
    return "https://eu.posthog.com";
  }
  if (trimmed.includes("us.posthog") || trimmed.includes("us.i.posthog")) {
    return "https://us.posthog.com";
  }
  return trimmed;
}

export function posthogSettingsUrl(host: string): string {
  return `${posthogAppHost(host)}/settings/user-api-keys`;
}

/** Project API Key lives under Project settings, not User settings. */
export function posthogProjectSettingsUrl(host: string): string {
  return `${posthogAppHost(host)}/settings/project`;
}

export async function posthogRequest(
  target: PosthogTarget,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = posthogAppHost(target.host);
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${target.apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function readPosthogError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { detail?: unknown; error?: unknown };
    const detail = json.detail ?? json.error;
    if (typeof detail === "string" && detail.length > 0) {
      return detail;
    }
  } catch {
    // Use the raw body below.
  }
  return text.slice(0, 280) || `PostHog HTTP ${response.status}`;
}

export async function verifyPosthogAccess(
  target: PosthogTarget,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const flags = await posthogRequest(
    target,
    `/api/projects/${target.projectId}/feature_flags/?limit=1`,
  );
  if (!flags.ok) {
    return {
      ok: false,
      error: `Could not read feature flags (${await readPosthogError(flags)}). Use a personal API key scoped to feature_flag:read and feature_flag:write.`,
    };
  }

  const query = await posthogRequest(
    target,
    `/api/projects/${target.projectId}/query/`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "growth-agent-scope-check",
        query: { kind: "HogQLQuery", query: "SELECT 1" },
      }),
    },
  );
  if (!query.ok) {
    return {
      ok: false,
      error: `Could not query events (${await readPosthogError(query)}). Add query:read on the same key. We only ever pull aggregate counts for a flag, never visitor ids.`,
    };
  }

  return { ok: true };
}

/**
 * The project API key (used by simulate_traffic's /batch/ push) is a
 * different credential from the personal key above — verified separately,
 * against PostHog's /decide/ endpoint (read-only: it just resolves flags for
 * a key, so this doesn't write fake events into the customer's project the
 * way a real /batch/ call would).
 */
export async function verifyPosthogProjectToken(
  host: string,
  projectToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = posthogAppHost(host);
  const res = await fetch(`${base}/decide/?v=3`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: projectToken }),
    cache: "no-store",
  });
  if (!res.ok) {
    return { ok: false, error: `Could not verify the project API key (${await readPosthogError(res)}).` };
  }
  return { ok: true };
}
