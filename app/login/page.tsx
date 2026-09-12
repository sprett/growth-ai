import { LoginForm } from "@/components/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="relative mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <p className="mb-10 m-0 font-mono text-[11px] tracking-[0.22em] text-mute uppercase">
        Growth agent · 01
      </p>
      <header className="mb-8">
        <h1 className="m-0 font-display text-[2.75rem] leading-[0.95] font-extrabold tracking-tight sm:text-5xl">
          Sign in.
          <span className="mt-2 block text-mute">Then wire the loop.</span>
        </h1>
        <p className="mt-5 mb-0 max-w-md text-lg leading-relaxed">
          GitHub is how we know you. Next you&apos;ll install the app on a
          repo and connect a scoped PostHog key — flags and counts, nothing
          nosier.
        </p>
      </header>
      <LoginForm authError={params.error === "auth"} />
    </div>
  );
}
