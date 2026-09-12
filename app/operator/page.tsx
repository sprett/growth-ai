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

export default function OperatorPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-7 px-6 py-9 pb-16">
      <header>
        <p className="m-0 font-mono text-xs tracking-[0.16em] text-mute uppercase">
          Growth agent
        </p>
        <h1 className="mt-1.5 mb-2.5 font-display text-[2.6rem] tracking-tight">
          Operator
        </h1>
        <p className="m-0 max-w-xl text-lg leading-relaxed">
          Dashboard shell. Pipeline, PostHog, and the playbook graph plug in
          here next.
        </p>
      </header>

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
            <span className="font-mono text-xs text-mute">idle</span>
          </li>
        ))}
      </ol>

      <p className="m-0 border-t border-ink/20 pt-3.5 font-mono text-[11px] text-mute">
        <Link href="/" className="inline-flex items-center gap-1.5">
          <ArrowLeft className="size-3" strokeWidth={1.75} />
          Foldline landing
        </Link>
      </p>
    </div>
  );
}
