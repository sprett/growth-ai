"use client";

import { saveProjectToken } from "@/app/actions/onboarding";
import { posthogProjectSettingsUrl } from "@/lib/posthog/customer";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function ProjectTokenForm({
  host,
  tokenSet,
}: {
  host: string | null;
  tokenSet: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await saveProjectToken(new FormData(event.currentTarget));
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaved(true);
    event.currentTarget.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[0.16em] text-mute uppercase">
          Project token
        </span>
        <span className="font-mono text-[10px] text-mute">
          {tokenSet ? "Set" : "Not set"}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          name="posthog_project_token"
          type="password"
          autoComplete="off"
          placeholder={tokenSet ? "•••••••••••• (enter a new value to replace)" : "phc_…"}
          className="min-w-0 flex-1 border border-rule bg-paper px-3 py-2.5 outline-none focus:shadow-cta"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 border border-ink bg-ink px-4 py-2.5 font-mono text-[11px] tracking-[0.08em] text-ticket uppercase transition disabled:opacity-45"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="m-0 font-mono text-[11px] leading-relaxed text-mute">
        The public, write-only token used to record synthetic experiment
        traffic — different from the personal API key.{" "}
        <a
          href={posthogProjectSettingsUrl(host ?? "https://eu.posthog.com")}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-4 hover:underline"
        >
          Open PostHog → Project settings
        </a>
      </p>
      {error ? <p className="m-0 font-mono text-xs text-[#C23A2B]">{error}</p> : null}
      {saved ? <p className="m-0 font-mono text-xs text-ink">Saved.</p> : null}
    </form>
  );
}
