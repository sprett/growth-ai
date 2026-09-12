# Growth AI

Hackathon build: you describe a UI experiment in plain language. The agent writes a variant, opens a real GitHub PR, creates a real PostHog feature flag, simulates traffic, learns which elements won, and opens the *next* PR itself.

Spec: [`docs/growth-agent-spec.md`](docs/growth-agent-spec.md)

## Status

Repo is set up. App scaffolding is next (toy landing page + pipeline stubs + Supabase schema).

## Clone

```bash
git clone https://github.com/sprett/growth-ai.git
```

If you need write access and cannot push, ask to be added as a collaborator.

## Accounts to create before hour 1

Both people can share one project per service. Put keys in `.env.local` (copy from `.env.example`). Never commit real keys.

| Service | Who needs an account | What to copy into `.env` | Free tier OK? |
|---|---|---|---|
| [GitHub](https://github.com) | Both (already on this repo) | Fine-grained PAT: Contents + Pull requests (write) on `sprett/growth-ai` | Yes |
| [PostHog Cloud](https://app.posthog.com/signup) | One shared project | Personal API key + project ID | Yes |
| [Supabase](https://supabase.com/dashboard) | One shared project | Project URL, anon key, service role key | Yes |
| OpenAI **or** Anthropic | One shared key | `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Paid usage, small |

Skip for v1: a GitHub App (relay has one — a PAT is enough for the demo), pgvector, ngrok (only needed when the merge webhook must hit your laptop).

## Split (from the spec)

- **Frontend:** toy landing page (CTA copy / color / placement), dashboard, PR diff viewer, learnings graph
- **Backend:** pipeline steps, PostHog flags + events, GitHub PRs + merge webhook, Supabase playbook
