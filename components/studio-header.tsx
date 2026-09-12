import { signOut } from "@/app/actions/auth";
import { LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StudioHeader({
  kicker = "Growth agent",
  subtitle,
  homeHref = "/",
}: {
  kicker?: string;
  subtitle?: string;
  homeHref?: string;
}) {
  return (
    <header className="mb-8 flex items-center justify-between gap-4 border-b-2 border-rule pb-4">
      <Link href={homeHref} className="min-w-0 no-underline">
        <p className="m-0 font-mono text-[11px] tracking-[0.18em] text-mute uppercase">
          {kicker}
        </p>
        {subtitle ? (
          <p className="m-0 truncate font-mono text-xs text-mute">{subtitle}</p>
        ) : null}
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="grid size-9 place-items-center border border-rule bg-ticket transition hover:shadow-cta"
          aria-label="Sign out"
        >
          <LogOut className="size-3.5" strokeWidth={1.75} />
        </button>
      </form>
    </header>
  );
}

export function Ticket({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn("ticket rise", className)}>{children}</section>;
}
