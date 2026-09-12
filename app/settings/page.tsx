import { GithubMark, PosthogMark } from "@/components/brand-icon";
import { ProjectTokenForm } from "@/components/project-token-form";
import { StudioHeader, Ticket } from "@/components/studio-header";
import { TeamCard } from "@/components/team-card";
import {
  isOnboarded,
  toPublicConnection,
  type ConnectionRow,
} from "@/lib/onboarding";
import { getOrgId, listTeammates } from "@/lib/org";
import { createServerSupabase } from "@/lib/supabase/server";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    redirect("/login");
  }

  const orgId = await getOrgId(supabase, userData.user);

  const { data } = await supabase
    .from("connections")
    .select(
      "github_installation_id, github_repo_full_name, posthog_api_key, posthog_project_token, posthog_project_id, posthog_host",
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

      <Link
        href="/"
        className="mb-6 inline-flex w-fit items-center gap-1.5 font-mono text-[11px] text-mute"
      >
        <ArrowLeft className="size-3" strokeWidth={1.75} />
        Chat
      </Link>

      <header className="mb-8">
        <h1 className="m-0 font-display text-[2.6rem] leading-[0.95] font-extrabold tracking-tight">
          Settings
        </h1>
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

      <Ticket className="mb-4">
        <ProjectTokenForm
          host={connection?.posthog_host ?? null}
          tokenSet={connection?.posthog_project_token_set ?? false}
        />
      </Ticket>

      <TeamCard
        teammates={teammates}
        currentUserId={userData.user.id}
        className="mb-4"
      />
    </div>
  );
}
