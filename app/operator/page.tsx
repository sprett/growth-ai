import { getOrgId } from "@/lib/org";
import { STEP_META, STEP_ORDER } from "@/lib/pipeline/step-meta";
import { createServerSupabase } from "@/lib/supabase/server";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

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

  const orgId = await getOrgId(supabase, userData.user);

  const { data, error } = await supabase
    .from("experiments")
    .select("id, name, prompt_text, status, cycle_number")
    .eq("org_id", orgId)
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
          Experiments for your account.
        </p>
      </header>

      {error ? (
        <p className="m-0 font-mono text-sm text-mute">{error.message}</p>
      ) : experiments.length === 0 ? (
        <p className="m-0 text-mute">No experiments yet. Start one from the chat on the dashboard.</p>
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
        {STEP_ORDER.map((stepName, index) => {
          const meta = STEP_META[stepName];
          return (
            <li
              key={stepName}
              className="grid grid-cols-[48px_auto_1fr] items-center gap-3 border-b border-ink/15 py-3"
            >
              <span className="font-mono text-xs text-mute">
                {String(index + 1).padStart(2, "0")}
              </span>
              <meta.icon className="size-4 text-mute" strokeWidth={1.75} />
              <span>{meta.label}</span>
            </li>
          );
        })}
      </ol>

      <Link href="/" className="inline-flex items-center gap-1.5 font-mono text-[11px] text-mute">
        <ArrowLeft className="size-3" strokeWidth={1.75} />
        Studio
      </Link>
    </div>
  );
}
