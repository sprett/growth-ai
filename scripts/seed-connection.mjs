import { createClient } from "@supabase/supabase-js";

const DEMO_ORG_ID = "11111111-1111-4111-8111-111111111111";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before seeding.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const row = {
  org_id: DEMO_ORG_ID,
  github_installation_id: process.env.DEMO_GITHUB_INSTALLATION_ID || null,
  github_repo_full_name:
    process.env.DEMO_GITHUB_REPO_FULL_NAME || "sprett/foldline",
  posthog_api_key: process.env.DEMO_POSTHOG_API_KEY || null,
  posthog_project_id: process.env.DEMO_POSTHOG_PROJECT_ID || null,
  posthog_host: process.env.DEMO_POSTHOG_HOST || null,
};

const { error } = await supabase.from("connections").upsert(row, {
  onConflict: "org_id",
});

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(
  `Seeded connections for ${row.github_repo_full_name} (PostHog key: ${row.posthog_api_key ? "set" : "missing"}).`,
);
