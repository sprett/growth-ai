import { signOut } from "@/app/actions/auth";
import type { ExperimentProgress, ExperimentVariantProgress } from "@/app/actions/experiment";
import { GithubMark } from "@/components/brand-icon";
import { ExperimentChat } from "@/components/experiment-chat";
import {
  isOnboarded,
  toPublicConnection,
  type ConnectionRow,
} from "@/lib/onboarding";
import { getOrgId } from "@/lib/org";
import { createServerSupabase } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { LogOut, MessageSquareText, Settings, SquarePen } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

type ExperimentListItem = {
  id: string;
  name: string | null;
  status: string | null;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ experiment?: string }>;
}) {
  const { experiment: selectedExperimentId } = await searchParams;

  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    redirect("/login");
  }

  const orgId = await getOrgId(supabase, userData.user);

  const { data: connectionRow } = await supabase
    .from("connections")
    .select(
      "github_installation_id, github_repo_full_name, posthog_api_key, posthog_project_token, posthog_project_id, posthog_host",
    )
    .eq("org_id", orgId)
    .maybeSingle();

  const connection = toPublicConnection(connectionRow as ConnectionRow | null);
  if (!isOnboarded(connection)) {
    redirect("/onboarding");
  }

  const repo = connection?.github_repo_full_name ?? "repo pending";

  const { data: experimentsData } = await supabase
    .from("experiments")
    .select("id, name, status")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(30);

  const experiments = (experimentsData ?? []) as ExperimentListItem[];

  let initialExperiment: { id: string; promptText: string; progress: ExperimentProgress } | null = null;

  if (selectedExperimentId) {
    const { data: selected } = await supabase
      .from("experiments")
      .select("id, prompt_text, status, current_step, active_hypothesis")
      .eq("id", selectedExperimentId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (selected) {
      const { data: variants } = await supabase
        .from("variants")
        .select("label, element, dimension, value, pr_url, posthog_flag_key")
        .eq("experiment_id", selected.id)
        .eq("org_id", orgId);

      const activeHypothesis = selected.active_hypothesis as Record<string, unknown> | null;
      const errorMessage =
        typeof activeHypothesis?.error_message === "string" ? activeHypothesis.error_message : null;

      initialExperiment = {
        id: selected.id as string,
        promptText: selected.prompt_text as string,
        progress: {
          status: selected.status as string | null,
          currentStep: selected.current_step as string | null,
          activeHypothesis,
          errorMessage,
          variants: (variants ?? []) as ExperimentVariantProgress[],
        },
      };
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-ledger">
      <aside className="flex w-64 shrink-0 flex-col border-r border-rule/40">
        <div className="flex h-14 shrink-0 items-center border-b border-rule/40 px-4">
          <p className="m-0 font-mono text-[11px] tracking-[0.18em] text-mute uppercase">
            Growth agent
          </p>
        </div>

        <div className="px-3 pt-3 pb-2">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg border border-rule px-3 py-2 font-mono text-[11px] tracking-[0.08em] uppercase transition-colors duration-150 hover:bg-ticket active:scale-[0.98]"
          >
            <SquarePen className="size-3.5" strokeWidth={1.75} />
            New chat
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-1">
          <p className="m-0 mb-1.5 px-1 font-mono text-[10px] tracking-[0.14em] text-mute uppercase">
            Chats
          </p>
          {experiments.length === 0 ? (
            <p className="m-0 px-1 py-2 text-[13px] text-mute">No chats yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {experiments.map((experiment) => (
                <li key={experiment.id}>
                  <Link
                    href={`/?experiment=${experiment.id}`}
                    className={cn(
                      "flex items-center gap-2 truncate rounded-lg px-2 py-1.5 text-[13px] transition-colors duration-150 hover:bg-ticket",
                      selectedExperimentId === experiment.id ? "bg-ticket" : "",
                    )}
                  >
                    <MessageSquareText className="size-3.5 shrink-0 text-mute" strokeWidth={1.75} />
                    <span className="truncate">{experiment.name ?? "Untitled"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-t border-rule/40 px-3">
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-[11px] tracking-[0.06em] text-mute uppercase transition-colors duration-150 hover:bg-ticket"
          >
            <Settings className="size-3.5" strokeWidth={1.75} />
            Settings
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="grid size-8 place-items-center rounded-lg text-mute transition-colors duration-150 hover:bg-ticket active:scale-[0.95]"
              aria-label="Sign out"
            >
              <LogOut className="size-3.5" strokeWidth={1.75} />
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-rule/40 px-6">
          <GithubMark className="size-4" />
          <span className="truncate font-mono text-[12px] text-mute">{repo}</span>
        </header>

        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden px-6 pb-6">
          <ExperimentChat key={selectedExperimentId ?? "new"} initialExperiment={initialExperiment} />
        </main>
      </div>
    </div>
  );
}
