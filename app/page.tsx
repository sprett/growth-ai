import { CtaButton } from "@/components/cta-button";
import { CTA_PLACEMENT, HEADLINE, type CtaPlacement } from "@/lib/experiment";
import {
  ClipboardList,
  Gauge,
  ListOrdered,
  Ticket,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const points: { icon: LucideIcon; text: string }[] = [
  {
    icon: ClipboardList,
    text: "Tear-off stubs with a carbon copy underneath",
  },
  {
    icon: ListOrdered,
    text: "One queue, numbered in the order people arrived",
  },
  {
    icon: WifiOff,
    text: "Works when the wifi doesn't",
  },
];

function ctaSlots(placement: CtaPlacement): {
  header: ReactNode;
  sidebar: ReactNode;
} {
  const cta = <CtaButton />;

  switch (placement) {
    case "header":
      return { header: cta, sidebar: null };
    case "sidebar":
      return { header: null, sidebar: cta };
    default: {
      const _exhaustive: never = placement;
      throw new Error(`Unhandled CTA placement: ${_exhaustive}`);
    }
  }
}

export default function Home() {
  const { header, sidebar } = ctaSlots(CTA_PLACEMENT);

  return (
    <div className="mx-auto flex min-h-screen max-w-[980px] flex-col gap-9 px-6 py-7">
      <header className="flex flex-wrap items-center gap-5 border-b-2 border-rule pb-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center border-2 border-ink font-display text-[13px] font-extrabold tracking-[0.12em]">
            FL
          </span>
          <span className="font-display text-[28px] font-bold tracking-tight">
            Foldline
          </span>
        </div>
        <p className="m-0 font-mono text-xs tracking-wide text-mute md:ml-auto">
          Vol. 01 · Shop edition
        </p>
        {header}
      </header>

      <div className="grid flex-1 grid-cols-1 items-start gap-10 md:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.7fr)]">
        <main>
          <p className="m-0 font-mono text-xs tracking-[0.16em] text-mute uppercase">
            For counters, not dashboards
          </p>
          <h1 className="mt-2 mb-4.5 font-display text-[clamp(2.2rem,5vw,3.6rem)] leading-[0.95] font-extrabold tracking-tight">
            {HEADLINE}
          </h1>
          <p className="mb-5.5 max-w-xl text-lg leading-relaxed">
            Foldline is a paper-first waitlist for bakeries, bike shops, and
            anywhere a clipboard still beats an iPad. Tickets stay in order.
            Names don&apos;t walk off.
          </p>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {points.map((point) => (
              <li key={point.text} className="flex items-start gap-2.5">
                <point.icon
                  className="mt-0.5 size-4 shrink-0 text-mute"
                  strokeWidth={1.75}
                />
                <span>{point.text}</span>
              </li>
            ))}
          </ul>
        </main>

        <aside className="flex flex-col gap-3.5 border border-dashed border-rule bg-ticket p-5.5 shadow-stamp">
          <p className="m-0 flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] uppercase">
            <Ticket className="size-3.5" strokeWidth={1.75} />
            Ticket 0147
          </p>
          <p className="m-0 leading-relaxed">
            Leave a name. We&apos;ll send a note when the first run of books
            ships — no drip campaign, one letter.
          </p>
          {sidebar}
          {sidebar ? null : (
            <p className="m-0 font-mono text-[11px] text-mute">
              The join button lives in the masthead.
            </p>
          )}
        </aside>
      </div>

      <footer className="flex justify-between gap-4 border-t border-ink/20 pt-3.5 font-mono text-[11px] text-mute">
        <span>Foldline · a toy landing page for A/B experiments</span>
        <Link href="/operator" className="inline-flex items-center gap-1.5">
          <Gauge className="size-3" strokeWidth={1.75} />
          Operator
        </Link>
      </footer>
    </div>
  );
}
