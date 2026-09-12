-- The `create_flag` step authenticates with a personal API key (Bearer,
-- scoped to feature_flag:read/write + query:read — see lib/posthog/customer.ts).
-- `simulate_traffic` posts to PostHog's /batch/ ingestion endpoint, which is a
-- *different* credential: the project token (public, write-only, safe to
-- expose client-side — what posthog-js calls its init `token`). Reusing the
-- personal key there fails with "API key is not valid: personal_api_key".
-- This column stores that second, distinct credential.
alter table public.connections
  add column if not exists posthog_project_token text;
