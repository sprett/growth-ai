import { OnboardingFlow } from "@/components/onboarding-flow";
import { StudioHeader } from "@/components/studio-header";
import {
  isOnboarded,
  toPublicConnection,
  type ConnectionRow,
} from "@/lib/onboarding";
import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ installation_id?: string; setup_action?: string }>;
}) {
  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    redirect("/login");
  }

  const params = await searchParams;
  const installationId = params.installation_id?.trim() ?? "";
  if (/^\d+$/.test(installationId)) {
    await supabase.from("connections").upsert(
      {
        org_id: userData.user.id,
        github_installation_id: installationId,
      },
      { onConflict: "org_id" },
    );
    redirect("/onboarding");
  }

  const { data } = await supabase
    .from("connections")
    .select(
      "github_installation_id, github_repo_full_name, posthog_api_key, posthog_project_id, posthog_host",
    )
    .eq("org_id", userData.user.id)
    .maybeSingle();

  const connection = toPublicConnection(data as ConnectionRow | null);
  if (isOnboarded(connection)) {
    redirect("/");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col px-6 py-10">
      <StudioHeader kicker="Setup" homeHref="/onboarding" />
      <header className="mb-8">
        <h1 className="m-0 font-display text-[2.5rem] leading-[0.95] font-extrabold tracking-tight">
          Two doors.
        </h1>
        <p className="mt-4 mb-0 text-lg leading-relaxed">
          Install the GitHub App on the product you want to experiment on.
          Then hand us a PostHog key that can only touch flags and the
          events tied to them.
        </p>
      </header>
      <OnboardingFlow
        connection={connection}
        githubAppSlug={process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? null}
      />
    </div>
  );
}
