"use client";

import { acceptInvite } from "@/app/actions/team";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function JoinTeamButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onJoin() {
    setPending(true);
    setError(null);
    const result = await acceptInvite(token);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        onClick={onJoin}
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2.5 bg-ink px-4 py-3.5 font-display text-sm font-bold tracking-wide text-ticket shadow-cta transition hover:shadow-cta-hover disabled:opacity-60"
      >
        {pending ? "Joining…" : "Join team"}
      </button>
      {error ? (
        <p className="mt-4 mb-0 font-mono text-xs text-[#C23A2B]">{error}</p>
      ) : null}
    </div>
  );
}
