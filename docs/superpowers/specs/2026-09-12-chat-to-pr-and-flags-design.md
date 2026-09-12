# Chat → real PR + real feature flag (design)

**Date:** 2026-09-12
**Status:** Approved, moving to implementation plan.

## 1. Goal

Wire the existing chat UI (`components/experiment-chat.tsx`) to actually
drive the pipeline described in `docs/growth-agent-spec.md`, far enough to
prove two things end-to-end today:

1. The pipeline can turn a plain-language prompt into a structured
   experiment and open a pull request (mocked GitHub side, see §2).
2. The pipeline can create a real PostHog multivariate feature flag on the
   already-connected tenant project (fully real, no mocking).

The chat is also being restyled to a ChatGPT/Claude-style transcript
instead of the current "Studio ticket" look.

## 2. Why GitHub is mocked, not real, for this pass

A teammate is independently building the real Octokit-backed GitHub App
integration (branch creation, commits, PR opening) against the same repo
this pipeline targets (`denizsaether/Student_App`). Building a second, real
implementation here would race that work and risk pushing conflicting
commits to a repo we don't own outright.

Instead we draw up a `GithubClient` interface and ship a mock
implementation behind it. The pipeline, the chat UI, and the data model are
built and testable today; swapping in the real client later is a one-line
change in `lib/github/index.ts`.

## 3. Discovered environment facts (verified live during design)

- `connections` row `org_id = 0b086141-730c-41de-bee3-cc85ea21043f` has a
  real `github_installation_id` (`161140199`) and a real, already-verified
  PostHog connection (`posthog_project_id = 272715`, EU cloud). This is the
  org we'll test against.
- That installation covers two repos owned by a teammate:
  `denizsaether/Student_App` and `denizsaether/jeopardy`. We're targeting
  **Student_App** — it already has PostHog wired client-side
  (`frontend/src/posthog.ts`).
- `connections.github_repo_full_name` was null for this org (the onboarding
  flow never backfills it — it only gets set by the seed script for the
  demo org). We'll hand-set it to `denizsaether/Student_App` as a one-time
  data fix; a real "resolve repo from installation" step is out of scope
  here (that's naturally part of the teammate's Octokit work or a later
  onboarding improvement).
- The tunable screen is `frontend/src/AuthPanel.tsx` — a signin/signup
  panel with inline JSX for headline, tagline, CTA label, and CTA button
  color. It is not yet refactored into named constants.
- `.env`'s `GITHUB_APP_PRIVATE_KEY` was stored as an unquoted multi-line
  PEM, which most dotenv-style parsers (including Next.js's) truncate to
  the first line. Fixed by rewriting it as a single quoted line with `\n`
  escapes. This fix matters for whoever loads that env var (including the
  teammate's Octokit code), independent of this feature.
- All tables from the spec's data model (`connections`, `experiments`,
  `variants`, `events`, `playbook_nodes`, `playbook_edges`) already exist
  in Supabase.

## 4. GitHub interface contract

`lib/github/types.ts`:

```ts
export type GithubTarget = {
  installationId: string;
  repoFullName: string;
  baseBranch: string;
};

export type FileEdit = { path: string; content: string };

export type OpenPrInput = {
  target: GithubTarget;
  branchName: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  files: FileEdit[];
};

export type OpenPrResult = { prUrl: string; prNumber: number; branchName: string };

export interface GithubClient {
  openPullRequest(input: OpenPrInput): Promise<OpenPrResult>;
}
```

`lib/github/mock-client.ts` implements `GithubClient`: builds a
deterministic-looking fake PR number, logs the would-be file contents for
debugging, and returns
`https://github.com/{repoFullName}/pull/{n}`. Never makes a network call.

`lib/github/index.ts` exports `getGithubClient(): GithubClient`, today
returning the mock. This is the single swap point for the real
Octokit-backed client.

## 5. Diff target fixture

`lib/pipeline/target-fixtures.ts` holds the *as-if-already-refactored*
tunable block for `AuthPanel.tsx`, since we are not pushing a real prep
commit to `Student_App` in this pass:

```ts
export const AUTH_PANEL_PATH = "frontend/src/AuthPanel.tsx";

export const AUTH_COPY_FIXTURE = `export const AUTH_COPY = {
  signin: {
    headline: "Logg inn",
    tagline: "Logg inn for å synkronisere fag og timer på tvers av enheter.",
    ctaLabel: "Logg inn",
    ctaColorClass: "bg-blue-600 hover:bg-blue-700",
  },
  signup: {
    headline: "Opprett konto",
    tagline: "Opprett konto med e-post. Du kan bli bedt om å bekrefte e-posten.",
    ctaLabel: "Opprett konto",
    ctaColorClass: "bg-blue-600 hover:bg-blue-700",
  },
};`;
```

This fixture is what `generateDiff` treats as "the current file content."
**Follow-up not done here:** actually committing this refactor to
`Student_App` for real, once the real `GithubClient` lands — flagged, not
built, in this pass.

## 6. Pipeline steps — replacing the stubs

Scope of tunable dimensions (matches the spec's non-goal of bounding
diff-gen): `element ∈ {cta_button, headline, tagline}`,
`dimension ∈ {copy, color}` (`color` only valid for `cta_button`).

- **`parseRequest(orgId, promptText)`** — real Anthropic call (Claude,
  `ANTHROPIC_API_KEY`) with a tool/JSON-schema call forcing
  `{ element, dimension, value, rationale }`, constrained to the enum
  above. Rejects/asks-for-clarification shape if the model can't map the
  prompt to an allowed element.
- **`generateDiff(orgId, parsed)`** — real Anthropic call given
  `AUTH_COPY_FIXTURE` + the parsed spec; returns the full new `AUTH_COPY`
  object literal (not a unified diff — a full block replacement, since the
  block is small and this avoids diff-apply failures) plus a short PR
  description. Basic shape validation (still parses as the same object
  keys) before proceeding.
- **`openPr(orgId, variantSpec)`** — calls
  `getGithubClient().openPullRequest(...)` with branch name
  `growth-agent/cycle-{n}-{slug}`, the new file block, and a PR body
  containing the before/after copy. Writes a `variants` row
  (`element`, `dimension`, `value`, `pr_url`, `posthog_flag_key: null`).
- **`createFlag(orgId, variantId)`** — real call to the existing
  `createMultivariateFlag` (`lib/posthog/flags.ts`) against the org's real
  connection. Stores the returned flag key back on the `variants` row.
  Unchanged from what's already implemented — just actually gets called
  now.

`simulateTraffic`, `analyzeResults`, `updatePlaybook`, `synthesizeNext`
remain stubs — out of scope for this pass.

## 7. Orchestration

`startExperiment` (extended, still in `app/actions/experiment.ts`) inserts
the `experiments` row, then synchronously runs
`parseRequest → generateDiff → openPr`, collecting an ordered
`StepResult[]` timeline (already the shape `lib/pipeline/types.ts`
defines), updates `experiments.status` to `"pr_open"`, and returns the
timeline to the client alongside the experiment id.

`createFlag` is **not** auto-chained — the spec ties it to a human merging
the PR, which is the intended pause point. Two ways to trigger it in this
pass:

1. A real webhook route, `app/api/github/webhook/route.ts`, verifying the
   `X-Hub-Signature-256` header against `GITHUB_WEBHOOK_SECRET`, calling
   `createFlag` on a `pull_request` `closed`+`merged` payload. Testable
   locally by running the smee client against
   `https://smee.io/agentic-loops` forwarding to
   `http://localhost:3000/api/github/webhook`. This is real, working code,
   independent of the mocked PR-open step — it'll matter once the
   teammate's real PRs start merging.
2. A manual "Create flag now" button on the PR step card in chat, since a
   mocked PR can't actually be merged on GitHub to fire a real webhook
   today. This is what actually gets exercised in this pass's demo.

## 8. Chat UI — ChatGPT/Claude-style transcript

Replace the dashed-border "ticket" look in `experiment-chat.tsx`:

- Plain scrolling transcript. User turns: soft rounded bubble, right-
  aligned. Assistant turns: plain text, left-aligned, no border/background.
- Each pipeline step renders as a compact inline status card under the
  assistant's reply — icon + label + status (spinner → check) + a
  one-line result, expandable for the parsed spec / diff / PR link.
  Modeled on Claude Code's own tool-call cards.
- Composer: rounded-3xl pill, auto-growing textarea, attach button left,
  round send button right — replacing the current square/dashed input.
- Image attach stays as-is functionally, restyled to match.

## 9. Data flow summary

```
chat submit
  → startExperiment (insert experiments row, status=parsing)
  → parseRequest (Anthropic)      → StepResult
  → generateDiff (Anthropic)      → StepResult
  → openPr (mock GithubClient)    → StepResult, variants row written
  → experiments.status = "pr_open"
  → timeline returned to chat, rendered as step cards

[separately]
"Create flag now" click  → createFlag (real PostHog) → variants.posthog_flag_key set
   -- or --
GitHub merge webhook (via smee) → createFlag (real PostHog)
```

## 10. Error handling

- Each pipeline step returns `StepResult { ok: boolean; message }` per the
  existing type — a failed step stops the chain, sets
  `experiments.status = "error"`, and the chat renders that step's card in
  an error state with the message. No partial/silent failures.
- `assertGithubTarget` / `assertPosthogTarget` (already implemented in
  `lib/pipeline/connection.ts`) continue to gate steps on the connection
  actually being complete.
- Anthropic calls: on a schema-validation failure (model didn't return the
  expected shape), retry once with a stricter reminder, then fail the step
  with a clear message rather than guessing.

## 11. Testing

- `pnpm typecheck` / `pnpm lint`.
- Manual: send a prompt in chat (e.g. "make the login CTA green and say
  'Kom i gang'"), watch parse → diff → PR cards resolve with the mock PR
  link, confirm a `variants` row exists with that `pr_url`. Click "Create
  flag now" and confirm a new flag appears in the real PostHog project
  (272715, EU) via the PostHog UI.
- No automated tests for the LLM-shaped steps in this pass (non-goal —
  the spec explicitly deprioritizes rigor here for the hackathon build);
  correctness is judged by the manual run above.

## 12. Explicitly out of scope for this pass

- Real Octokit/GitHub writes (teammate's work).
- Actually committing the `AUTH_COPY` refactor to `Student_App`.
- `simulateTraffic`, `analyzeResults`, `updatePlaybook`, `synthesizeNext`.
- Backfilling `github_repo_full_name` generically for future orgs (this
  pass hand-sets it for the one real org we're testing).
