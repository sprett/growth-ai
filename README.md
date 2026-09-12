# Growth AI

Operator + pipeline. Users sign in, connect a GitHub repo and PostHog project, then describe experiments in chat.

Spec: [`docs/growth-agent-spec.md`](docs/growth-agent-spec.md)

## Run

```bash
nvm use
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). **Continue with GitHub** is the main path.

### GitHub login (one-time dashboard setup)

This uses **Supabase Auth’s GitHub provider**, not our `.env`. Paste the Client ID and Client Secret only in Supabase — don’t commit them.

1. On the GitHub App: **Callback URL** must be  
   `https://fxltxeyrzspjbpkugjqu.supabase.co/auth/v1/callback`  
   Generate a **client secret** if you only have the Client ID so far.
2. [Supabase → Authentication → Providers → GitHub](https://supabase.com/dashboard/project/fxltxeyrzspjbpkugjqu/auth/providers): enable it, paste Client ID + secret.
3. [URL configuration](https://supabase.com/dashboard/project/fxltxeyrzspjbpkugjqu/auth/url-configuration): Site URL `http://localhost:3000`, redirect allow list must include `http://localhost:3000/auth/callback`.

Set `NEXT_PUBLIC_GITHUB_APP_SLUG` to the app slug (e.g. `hackathon-agentic-app`, not the full `github.com/apps/...` URL) for the *install on a repo* onboarding step (separate from login).

PostHog is the personal-API-key paste-in from the spec (Section 11).

The fake-customer landing page is a **separate repo**.
