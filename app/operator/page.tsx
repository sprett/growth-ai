import { createServerSupabase } from "@/lib/supabase/server";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Flag,
  GitPullRequest,
  MessageSquareText,
  Sparkles,
  SquarePen,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

const steps: { label: string; icon: LucideIcon }[] = [
  { label: "Parse request", icon: MessageSquareText },
  { label: "Generate diff", icon: SquarePen },
  { label: "Open PR", icon: GitPullRequest },
  { label: "Create flag", icon: Flag },
  { label: "Simulate traffic", icon: Activity },
  { label: "Analyze results", icon: BarChart3 },
  { label: "Update playbook", icon: BookOpen },
  { label: "Synthesize next hypothesis", icon: Sparkles },
];

type ExperimentRow = {
  id: string;
  name: string | null;
  prompt_text: string | null;
  status: string | null;
  cycle_number: number | null;
};

export default async function PipelinePage() {
  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("experiments")
    .select("id, name, prompt_text, status, cycle_number")
    .eq("org_id", userData.user.id)
    .order("created_at", { ascending: false });

  const experiments = (data ?? []) as ExperimentRow[];

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-7 px-6 py-9 pb-16">
      <header>
        <p className="m-0 font-mono text-xs tracking-[0.16em] text-mute uppercase">
          Pipeline
        </p>
        <h1 className="mt-1.5 mb-2.5 font-display text-[2.6rem] tracking-tight">
          Steps
        </h1>
        <p className="m-0 text-lg leading-relaxed">
          Experiments for your account. The loop still runs as stubs.
        </p>
      </header>

      {error ? (
        <p className="m-0 font-mono text-sm text-mute">{error.message}</p>
      ) : experiments.length === 0 ? (
        <p className="m-0 text-mute">No experiments yet. Chat lands on the dashboard next.</p>
      ) : (
        <ul className="m-0 list-none border-t border-ink/20 p-0">
          {experiments.map((experiment) => (
            <li
              key={experiment.id}
              className="flex flex-col gap-1 border-b border-ink/15 py-3"
            >
              <span className="font-display text-lg tracking-tight">
                {experiment.name ?? "Untitled"}
              </span>
              <span className="font-mono text-[11px] text-mute">
                cycle {experiment.cycle_number ?? 1} · {experiment.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ol className="m-0 list-none border-t border-ink/20 p-0">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className="grid grid-cols-[48px_auto_1fr_auto] items-center gap-3 border-b border-ink/15 py-3"
          >
            <span className="font-mono text-xs text-mute">
              {String(index + 1).padStart(2, "0")}
            </span>
            <step.icon className="size-4 text-mute" strokeWidth={1.75} />
            <span>{step.label}</span>
            <span className="font-mono text-xs text-mute">stub</span>
          </li>
        ))}
      </ol>

      <Link href="/" className="inline-flex items-center gap-1.5 font-mono text-[11px] text-mute">
        <ArrowLeft className="size-3" strokeWidth={1.75} />
        Studio
      </Link>
    </div>
  );
}
