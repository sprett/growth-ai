import { getInvitePreview } from "@/app/actions/team";
import { JoinTeamButton } from "@/components/join-team-button";
import { StudioHeader } from "@/components/studio-header";
import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const preview = await getInvitePreview(token);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <StudioHeader kicker="Invite" homeHref="/invite" />

      {preview.status === "invalid" ? (
        <>
          <header className="mb-8">
            <h1 className="m-0 font-display text-[2.5rem] leading-[0.95] font-extrabold tracking-tight">
              Link&apos;s dead.
            </h1>
            <p className="mt-4 mb-0 text-lg leading-relaxed">
              This invite has already been used or doesn&apos;t exist. Ask
              whoever sent it for a new one.
            </p>
          </header>
        </>
      ) : (
        <>
          <header className="mb-8">
            <h1 className="m-0 font-display text-[2.5rem] leading-[0.95] font-extrabold tracking-tight">
              Join the team.
            </h1>
            <p className="mt-4 mb-0 text-lg leading-relaxed">
              You&apos;ve been invited to an existing workspace. GitHub and
              PostHog are already wired — you&apos;ll land straight on the
              dashboard.
            </p>
          </header>
          <JoinTeamButton token={token} />
        </>
      )}
    </div>
  );
}
