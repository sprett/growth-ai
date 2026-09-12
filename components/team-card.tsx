"use client";

import { createInvite } from "@/app/actions/team";
import { Ticket } from "@/components/studio-header";
import type { Teammate } from "@/lib/org";
import { cn } from "@/lib/utils";
import { Check, Copy, Users } from "lucide-react";
import { useState } from "react";

export function TeamCard({
  teammates,
  currentUserId,
  className,
}: {
  teammates: Teammate[];
  currentUserId: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onInvite() {
    setPending(true);
    setError(null);
    setCopied(false);
    const result = await createInvite();
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setLink(`${window.location.origin}/invite/${result.token}`);
  }

  async function onCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  return (
    <Ticket className={cn("rise-delay-2 p-4", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center border border-rule">
            <Users className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="m-0 font-display text-xl font-bold tracking-tight">
              Team
            </h2>
            <p className="m-0 font-mono text-[11px] text-mute">
              {teammates.length} {teammates.length === 1 ? "person" : "people"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onInvite}
          disabled={pending}
          className="shrink-0 border border-rule px-3 py-2 font-mono text-[11px] tracking-wide uppercase disabled:opacity-60"
        >
          {pending ? "Generating…" : "Invite teammate"}
        </button>
      </div>

      <ul className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
        {teammates.map((teammate) => (
          <li
            key={teammate.user_id}
            className="flex items-center gap-2 font-mono text-xs"
          >
            <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full border border-rule bg-paper">
              {teammate.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={teammate.avatar_url}
                  alt=""
                  className="size-full object-cover"
                />
              ) : null}
            </span>
            <span className="truncate">
              {teammate.github_login ?? teammate.user_id.slice(0, 8)}
            </span>
            {teammate.user_id === currentUserId ? (
              <span className="text-mute">(you)</span>
            ) : null}
            <span className="text-mute">· {teammate.role}</span>
          </li>
        ))}
      </ul>

      {link ? (
        <div className="flex items-center gap-2 border border-dashed border-rule bg-paper px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
            {link}
          </span>
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0"
            aria-label="Copy invite link"
          >
            {copied ? (
              <Check className="size-3.5" strokeWidth={2} />
            ) : (
              <Copy className="size-3.5" strokeWidth={1.75} />
            )}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="m-0 mt-2 font-mono text-xs text-[#C23A2B]">{error}</p>
      ) : null}
    </Ticket>
  );
}
