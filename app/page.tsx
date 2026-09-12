import { GithubMark, PosthogMark } from "@/components/brand-icon";
import { ExperimentChat } from "@/components/experiment-chat";
import { StudioHeader, Ticket } from "@/components/studio-header";
import { TeamCard } from "@/components/team-card";
import {
  isOnboarded,
  toPublicConnection,
  type ConnectionRow,
} from "@/lib/onboarding";
import { getOrgId, listTeammates } from "@/lib/org";
import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    redirect("/login");
  }

  const orgId = await getOrgId(supabase, userData.user);

  const { data } = await supabase
    .from("connections")
    .select(
      "github_installation_id, github_repo_full_name, posthog_api_key, posthog_project_id, posthog_host",
    )
    .eq("org_id", orgId)
    .maybeSingle();

  const connection = toPublicConnection(data as ConnectionRow | null);
  if (!isOnboarded(connection)) {
    redirect("/onboarding");
  }

  const teammates = await listTeammates(supabase);

  const repo = connection?.github_repo_full_name ?? "repo pending";
  const project = connection?.posthog_project_id ?? "";
  const cloud = connection?.posthog_host?.includes("eu") ? "EU" : "US";

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
      <StudioHeader subtitle={repo} />

      <header className="mb-8">
        <h1 className="m-0 font-display text-[2.6rem] leading-[0.95] font-extrabold tracking-tight">
          Dashboard
        </h1>
        <p className="mt-3 mb-0 text-lg leading-relaxed">
          Describe an experiment below — the agent opens a PR on {repo} and
          writes a feature flag in this PostHog project.
        </p>
      </header>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Ticket className="flex items-center gap-3 p-4">
          <span className="grid size-10 place-items-center bg-ink text-ticket">
            <GithubMark className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="m-0 font-mono text-[10px] tracking-[0.16em] text-mute uppercase">
              GitHub
            </p>
            <p className="m-0 truncate font-display text-lg font-bold">{repo}</p>
          </div>
        </Ticket>
        <Ticket className="rise-delay flex items-center gap-3 p-4">
          <PosthogMark className="size-10 shrink-0" />
          <div className="min-w-0">
            <p className="m-0 font-mono text-[10px] tracking-[0.16em] text-mute uppercase">
              PostHog · {cloud}
            </p>
            <p className="m-0 truncate font-display text-lg font-bold">
              Project {project}
            </p>
          </div>
        </Ticket>
      </div>

      <TeamCard
        teammates={teammates}
        currentUserId={userData.user.id}
        className="mb-4"
      />

      <Ticket className="rise-delay-2">
        <ExperimentChat />
      </Ticket>
    </div>
  );
}
