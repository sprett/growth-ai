"use client";

import { GithubMark } from "@/components/brand-icon";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { useState } from "react";

export function LoginForm({
  authError,
  next,
}: {
  authError?: boolean;
  next?: string;
}) {
  const [error, setError] = useState<string | null>(
    authError
      ? "GitHub sign-in failed. Check the provider is enabled in Supabase."
      : null,
  );
  const [pending, setPending] = useState(false);

  async function signInWithGithub() {
    setError(null);
    setPending(true);
    const supabase = createBrowserSupabase();
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    if (next) {
      callbackUrl.searchParams.set("next", next);
    }
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: callbackUrl.toString(),
        scopes: "read:user user:email",
      },
    });
    setPending(false);
    if (oauthError) {
      setError(oauthError.message);
    }
  }

  return (
    <div className="ticket rise p-6 sm:p-8">
      <button
        type="button"
        disabled={pending}
        onClick={signInWithGithub}
        className="inline-flex w-full items-center justify-center gap-2.5 bg-ink px-4 py-3.5 font-display text-sm font-bold tracking-wide text-ticket shadow-cta transition hover:shadow-cta-hover disabled:opacity-60"
      >
        <GithubMark className="size-4" />
        {pending ? "Redirecting…" : "Continue with GitHub"}
      </button>
      {error ? (
        <p className="mt-4 mb-0 font-mono text-xs text-[#C23A2B]">{error}</p>
      ) : (
        <p className="mt-4 mb-0 font-mono text-[11px] leading-relaxed text-mute">
          We only ask GitHub for your identity. Repo access comes from the app
          you install next.
        </p>
      )}
    </div>
  );
}
