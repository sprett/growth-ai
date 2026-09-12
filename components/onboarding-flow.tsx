"use client";

import {
  saveGithubInstallation,
  savePosthogConnection,
} from "@/app/actions/onboarding";
import { GithubMark, PosthogMark } from "@/components/brand-icon";
import { Ticket } from "@/components/studio-header";
import {
  githubAppInstallUrl,
  isGithubConnected,
  isPosthogConnected,
  type PublicConnection,
} from "@/lib/onboarding";
import { POSTHOG_KEY_SCOPES, posthogSettingsUrl } from "@/lib/posthog/customer";
import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const POSTHOG_HOSTS = [
  { label: "EU cloud", value: "https://eu.posthog.com" },
  { label: "US cloud", value: "https://us.posthog.com" },
] as const;

function StatusPill({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase",
        done ? "text-ink" : "text-mute",
      )}
    >
      <span
        className={cn(
          "grid size-4 place-items-center border",
          done ? "border-ink bg-ink text-ticket" : "border-rule",
        )}
      >
        {done ? <Check className="size-2.5" strokeWidth={3} /> : null}
      </span>
      {label}
    </span>
  );
}

export function OnboardingFlow({
  connection,
  githubAppSlug,
}: {
  connection: PublicConnection | null;
  githubAppSlug: string | null;
}) {
  const router = useRouter();
  const githubDone = isGithubConnected(connection);
  const posthogDone = isPosthogConnected(connection);
  const installUrl = githubAppInstallUrl(githubAppSlug);

  const [githubError, setGithubError] = useState<string | null>(null);
  const [posthogError, setPosthogError] = useState<string | null>(null);
  const [githubPending, setGithubPending] = useState(false);
  const [posthogPending, setPosthogPending] = useState(false);
  const [showInstallId, setShowInstallId] = useState(false);

  async function onPasteInstall(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const installationId = String(form.get("github_installation_id") ?? "");
    setGithubPending(true);
    setGithubError(null);
    const result = await saveGithubInstallation(installationId);
    setGithubPending(false);
    if (result.error) {
      setGithubError(result.error);
      return;
    }
    router.refresh();
  }

  async function onPosthog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPosthogPending(true);
    setPosthogError(null);
    const result = await savePosthogConnection(
      new FormData(event.currentTarget),
    );
    setPosthogPending(false);
    if (result.error) {
      setPosthogError(result.error);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Ticket>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center bg-ink text-ticket">
              <GithubMark className="size-5" />
            </span>
            <div>
              <h2 className="m-0 font-display text-xl font-bold tracking-tight">
                Install GitHub App
              </h2>
              <p className="m-0 font-mono text-[11px] text-mute">
                Opens PRs on the repo you pick. Nothing else.
              </p>
            </div>
          </div>
          <StatusPill
            done={githubDone}
            label={githubDone ? "Installed" : "Needed"}
          />
        </div>

        {installUrl ? (
          <a
            href={installUrl}
            className="inline-flex w-full items-center justify-center gap-2.5 bg-ink px-4 py-3.5 font-display text-sm font-bold tracking-wide text-ticket shadow-cta transition hover:shadow-cta-hover"
          >
            <GithubMark className="size-4" />
            {githubDone ? "Manage GitHub App" : "Install GitHub App"}
          </a>
        ) : (
          <p className="m-0 border border-dashed border-rule bg-paper px-3 py-3 font-mono text-xs leading-relaxed text-mute">
            Set <span className="text-ink">NEXT_PUBLIC_GITHUB_APP_SLUG</span>{" "}
            once the app exists. Until then, paste the installation ID after you
            create it.
          </p>
        )}

        {githubError ? (
          <p className="mt-3 mb-0 font-mono text-xs text-[#C23A2B]">
            {githubError}
          </p>
        ) : null}
      </Ticket>

      <Ticket className="rise-delay">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <PosthogMark className="size-10" />
            <div>
              <h2 className="m-0 font-display text-xl font-bold tracking-tight">
                Connect PostHog
              </h2>
              <p className="m-0 font-mono text-[11px] text-mute">
                Flags and aggregate events only. No visitor data.
              </p>
            </div>
          </div>
          <StatusPill
            done={posthogDone}
            label={posthogDone ? "Connected" : "Needed"}
          />
        </div>

        <p className="m-0 mb-4 text-[15px] leading-relaxed">
          Create a <strong>personal API key</strong> with just these scopes. We
          create flags for experiments, then read counts grouped by variant —
          never distinct ids, recordings, or people.
        </p>

        <ul className="m-0 mb-4 flex list-none flex-wrap gap-2 p-0">
          {POSTHOG_KEY_SCOPES.map((scope) => (
            <li
              key={scope}
              className="border border-rule bg-paper px-2 py-1 font-mono text-[11px]"
            >
              {scope}
            </li>
          ))}
        </ul>

        <a
          href={posthogSettingsUrl(
            connection?.posthog_host ?? "https://eu.posthog.com",
          )}
          target="_blank"
          rel="noreferrer"
          className="mb-5 inline-flex font-mono text-[11px] tracking-[0.08em] text-mute underline-offset-4 hover:underline"
        >
          Open PostHog → User API keys
        </a>

        {posthogDone ? (
          <p className="m-0 border border-rule bg-paper px-3 py-3 font-mono text-xs leading-relaxed">
            Project {connection?.posthog_project_id} on{" "}
            {connection?.posthog_host?.includes("eu") ? "EU" : "US"} cloud. The
            key stays on the server.
          </p>
        ) : null}

        <form onSubmit={onPosthog} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] tracking-[0.16em] text-mute uppercase">
              Personal API key
            </span>
            <input
              name="posthog_api_key"
              type="password"
              required
              autoComplete="off"
              placeholder="phx_…"
              className="border border-rule bg-paper px-3 py-2.5 outline-none focus:shadow-cta"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] tracking-[0.16em] text-mute uppercase">
                Project ID
              </span>
              <input
                name="posthog_project_id"
                required
                defaultValue={connection?.posthog_project_id ?? ""}
                className="border border-rule bg-paper px-3 py-2.5 outline-none focus:shadow-cta"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] tracking-[0.16em] text-mute uppercase">
                Cloud
              </span>
              <select
                name="posthog_host"
                defaultValue={
                  connection?.posthog_host ?? "https://eu.posthog.com"
                }
                className="border border-rule bg-paper px-3 py-2.5 outline-none focus:shadow-cta"
              >
                {POSTHOG_HOSTS.map((host) => (
                  <option key={host.value} value={host.value}>
                    {host.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {posthogError ? (
            <p className="m-0 font-mono text-xs text-[#C23A2B]">
              {posthogError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={posthogPending || !githubDone}
            className="bg-ink px-4 py-3.5 font-display text-sm font-bold tracking-wide text-ticket shadow-cta disabled:opacity-45"
          >
            {posthogPending
              ? "Checking scopes…"
              : githubDone
                ? "Connect PostHog"
                : "Install GitHub first"}
          </button>
        </form>
      </Ticket>
    </div>
  );
}
